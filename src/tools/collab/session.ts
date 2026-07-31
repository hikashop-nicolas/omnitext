import type * as Y from "yjs";
import { t } from "../../i18n";
import type { CollabBinding } from "../../core/types";
import { BaseTransfer, type BaseDoc } from "./base";
import { newRoomKey, type RoomKey } from "./link";
import { CollabProvider, type Peer } from "./provider";
import { localTransport } from "./local-transport";
import { trysteroTransport, type CollabTransport } from "./transport";

// One live collaboration session: a room, a shared document, the base file, and the
// active editor's binding.
//
// Everything the session needs from the application arrives through SessionHost rather
// than through HostAPI, so the whole lifecycle is testable with no browser, no network
// and no editor.

// Removing someone from a session.
//
// Closing their connection would be theatre: they still hold the link, and a Trystero
// identity is fresh on every page load, so there is nothing to blocklist them by. What
// works is re-keying. Everyone else is told the new room over the connections that
// already exist; the person being removed is not, and is left holding a key to a room
// nobody is in.
//
// The new key travels hop by hop, each peer forwarding to its own peers except the sender
// and except the person being removed. That reuses the relay rule the sync channel
// already needs, and it matters here for a specific reason: the mesh is not guaranteed
// complete, so a peer the host cannot see directly still gets the key from whoever can
// see it. Only someone whose every path runs through the removed peer is stranded, and
// the session reports that rather than losing them quietly.
const CONTROL = { rekey: 1, evicted: 2 } as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const controlFrame = (kind: number, value: unknown): Uint8Array => {
  const body = textEncoder.encode(JSON.stringify(value));
  const out = new Uint8Array(body.length + 1);
  out[0] = kind;
  out.set(body, 1);
  return out;
};

interface RekeyMessage {
  room: RoomKey;
  /** The peer this re-key is hiding from, so every hop can leave it out. */
  exclude: string;
}

export interface ChatMessage {
  id: string;
  author: string;
  colour: string;
  text: string;
  /**
   * Sender's clock, for display only. It is deliberately NOT what the log is ordered by:
   * peers' clocks are not synchronised, so sorting by it would show different people a
   * different conversation. The log keeps CRDT order, which is the same for everyone and
   * preserves causality; two messages sent at the same instant may appear in either order.
   */
  at: number;
}

/** Where the chat lives in the shared document. Separate from anything the editor binds. */
const CHAT = "chat";
/** Session facts the core owns, as opposed to anything an editor binds. */
const META = "collab.meta";
const META_EDITOR = "editor";

export interface SessionHost {
  /** The document this session is built on, for the host to serve. Null if none is open. */
  currentDoc(): Promise<BaseDoc | null>;
  /** What this peer holds right now, so a joiner can refuse rather than lose work. */
  localState(): { hash: string; dirty: boolean } | null;
  /** A verified base arrived: open it, then re-bind the editor to the session. */
  openBase(doc: BaseDoc): Promise<void> | void;
  /** The active editor's binding, or null when this editor cannot collaborate. */
  binding(): CollabBinding | null;
  /** Which editor is showing the document. A binding belongs to one, so two peers in
   *  different editors would sync nothing while looking connected. */
  editorId(): string | null;
  /** Anything the person needs told. */
  notify(message: string): void;
  /** We were removed from the session: close the document, per the product decision. */
  onEvicted?(): void;
  /** Called whenever the peer list or connection state changes, for the UI. */
  onChange?(): void;
}

/** The default name, when the person has not set one. */
export const GUEST = "Guest";

/**
 * The lowest "Guest n" not already in use. Two people who have both left the name unset
 * would otherwise be Guest 1 twice, which is worse than no name at all: the peer list, the
 * badges and the chat would all name two different people identically.
 */
export function freeGuestName(taken: readonly string[]): string {
  const used = new Set(
    taken
      .map((n) => new RegExp(`^${GUEST} (\\d+)$`).exec(n)?.[1])
      .filter((n): n is string => !!n)
      .map(Number),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${GUEST} ${n}`;
}

export interface SessionOptions {
  /** Omit to start a new room; pass the key from a link to join one. */
  key?: RoomKey;
  /** Self-chosen, no identity attached. Empty means "call me Guest n". */
  name: string;
  colour: string;
  /** A view-only session: mirror edits in, publish none out. */
  readOnly?: boolean;
  /** Test seam. */
  makeTransport?(key: RoomKey): CollabTransport;
  /** How long to wait for the others to follow a re-key before reporting who did not. */
  followMs?: number;
}

/**
 * Same-browser tabs pair instantly over BroadcastChannel; everyone else goes through the
 * relay. Opt-in rather than automatic on localhost, because the local path does not
 * exercise WebRTC at all: making it the default there would hide exactly the failures the
 * real transport is there to surface.
 */
export function localModeRequested(search: string = typeof location === "undefined" ? "" : location.search): boolean {
  return new URLSearchParams(search).get("collab") === "local";
}

const defaultTransport = (key: RoomKey): CollabTransport =>
  localModeRequested() ? localTransport(key.roomId) : trysteroTransport({ roomId: key.roomId, secret: key.secret });

export class CollabSession {
  private currentKey: RoomKey;
  /** True for the peer that started the room: the only one that seeds the shared doc. */
  readonly isHost: boolean;
  readonly readOnly: boolean;
  readonly provider: CollabProvider;
  private readonly base: BaseTransfer;
  private readonly host: SessionHost;
  private readonly makeTransport: (key: RoomKey) => CollabTransport;
  private binding: CollabBinding | null = null;
  private bound = false;
  private closed = false;
  private unsupported = false;
  private wrongEditor = false;
  private me: { name: string; colour: string };
  /** True while the name is one we picked, so it may be renumbered as peers appear. */
  private autoName: boolean;
  /** Rooms we have already moved through, so a stale re-key cannot bounce us back. */
  private readonly seenRooms = new Set<string>();
  private readonly followMs: number;

  constructor(host: SessionHost, opts: SessionOptions) {
    this.host = host;
    this.isHost = !opts.key;
    this.currentKey = opts.key ?? newRoomKey();
    this.readOnly = opts.readOnly ?? false;
    this.autoName = !opts.name.trim();
    this.me = { name: opts.name.trim() || `${GUEST} 1`, colour: opts.colour };
    this.followMs = opts.followMs ?? 2_000;
    this.makeTransport = opts.makeTransport ?? defaultTransport;

    this.provider = new CollabProvider(this.makeTransport(this.currentKey));
    this.announce();

    this.base = new BaseTransfer(
      (payload, peerId) => this.provider.sendOn("base", payload, peerId),
      {
        local: () => this.host.localState(),
        serve: () => this.host.currentDoc(),
        accept: (doc) => void this.onBaseArrived(doc),
        // Same file on both sides: nothing to fetch, but we still have to bind.
        alreadyHave: () => void this.attachWhenSynced(),
        report: (m) => this.host.notify(m),
      },
    );

    this.provider.onChannel("base", (payload, peerId) => void this.base.receive(payload, peerId));
    this.provider.onChannel("control", (payload, peerId) => void this.onControl(payload, peerId));
    // Only the peer that started the room serves the base; joiners never offer theirs.
    if (this.isHost) this.provider.onPeerJoined((peerId) => void this.base.offerTo(peerId));
    this.provider.onPeersChanged(() => {
      this.renumber();
      this.host.onChange?.();
    });
  }

  get key(): RoomKey {
    return this.currentKey;
  }

  /**
   * Take the lowest free "Guest n" once the other peers are known. Only while the name is
   * still one we chose: renaming someone who typed their own name would be rude and would
   * also fight them every time a peer joined.
   */
  private renumber(): void {
    if (!this.autoName || this.closed) return;
    const peers = this.provider.peers();

    // Only move on an actual clash, and only one side of it. Renumbering to "the lowest
    // free" unconditionally had both peers start as Guest 1, both see the other as Guest 1,
    // and swap numbers forever. The lower client id keeps the name; everyone else moves.
    const clash = peers.filter((p) => p.name === this.me.name);
    if (!clash.length) return;
    if (clash.every((p) => p.clientId > this.doc.clientID)) return; // we were here first

    const wanted = freeGuestName([...peers.map((p) => p.name), this.me.name]);
    if (wanted === this.me.name) return;
    this.me = { ...this.me, name: wanted };
    this.announce();
  }

  private get doc(): { clientID: number } {
    return this.provider.doc;
  }

  /** Change the name the others see, without interrupting the session. */
  setName(name: string): void {
    this.autoName = false; // theirs now, so stop renumbering it
    this.me = { ...this.me, name };
    this.announce();
    this.host.onChange?.();
  }

  get myName(): string {
    return this.me.name;
  }

  /** Presence carries our transport id, which is how another peer can name us to remove us. */
  private announce(): void {
    this.provider.setPresence({ ...this.me, peerId: this.provider.selfId });
  }

  /**
   * Attach the active editor. The host does this at once, since its own document is the
   * base. A joiner waits: binding before the base arrives would seed the session with
   * whatever it happened to have open.
   */
  async start(): Promise<void> {
    if (this.isHost) await this.attach();
  }

  private async attach(): Promise<void> {
    if (this.bound || this.closed) return;
    const binding = this.host.binding();
    if (!binding) {
      this.unsupported = true;
      this.host.notify(t("collab.cannotCollaborate"));
      this.host.onChange?.();
      return;
    }
    this.unsupported = false;

    // A binding belongs to an editor. If the seeder shared through a different one, the
    // two would sit in a session that reports itself connected while neither ever sees the
    // other's edits, which looks exactly like working. Say so instead.
    const meta = this.provider.doc.getMap<string>(META);
    const mine = this.host.editorId();
    if (this.isHost) {
      if (mine) meta.set(META_EDITOR, mine);
    } else {
      const theirs = meta.get(META_EDITOR);
      if (theirs && mine && theirs !== mine) {
        this.wrongEditor = true;
        this.host.notify(t("collab.wrongEditor"));
        this.host.onChange?.();
        return;
      }
    }
    this.wrongEditor = false;

    this.binding = binding;
    this.bound = true;
    await binding.bind({
      doc: this.provider.doc,
      awareness: this.provider.awareness,
      seed: this.isHost,
      readOnly: this.readOnly,
    });
    this.host.onChange?.();
  }

  private async onBaseArrived(doc: BaseDoc): Promise<void> {
    await this.host.openBase(doc);
    // The editor was replaced along with the document, so ask for its binding again.
    this.binding = null;
    this.bound = false;
    await this.attachWhenSynced();
  }

  /**
   * Bind only once the session's contents have actually arrived. Binding earlier would
   * have the joiner adopt an empty shared document and blank what it had open.
   */
  private async attachWhenSynced(): Promise<void> {
    if (this.bound || this.closed) return;
    await this.provider.whenSynced();
    if (this.closed) return;
    await this.attach();
  }

  /**
   * A running session pins the editor.
   *
   * Re-attaching to whatever the person switched to looks obliging and is unsafe: the
   * shared shape belongs to the editor, so the new binding would find its own shape empty.
   * The seeder would then write a second shape into the same document, leaving everyone
   * else on the first and seeing nothing; a joiner adopting an empty shape would blank
   * what is on its screen. Neither is recoverable, and neither announces itself.
   */
  get pinsEditor(): boolean {
    // Only once actually bound. A peer told it is in the wrong editor has to be able to
    // switch to the right one, and pinning before binding forbade the very thing the
    // mismatch message asks for.
    return !this.closed && this.bound;
  }

  peers(): Peer[] {
    return this.provider.peers();
  }

  // Chat rides in the shared document rather than on its own channel, which gives it
  // ordering, history for anyone who joins late, and the partial-mesh handling already
  // built, at no extra cost. It is never written to the file.

  private get chatLog(): Y.Array<ChatMessage> {
    return this.provider.doc.getArray<ChatMessage>(CHAT);
  }

  messages(): ChatMessage[] {
    return this.chatLog.toArray();
  }

  sendMessage(text: string): void {
    const body = text.trim();
    if (!body || this.closed) return;
    this.chatLog.push([
      {
        id: crypto.randomUUID(),
        author: this.me.name,
        colour: this.me.colour,
        text: body,
        at: Date.now(),
      },
    ]);
  }

  /** Fires on every change to the log, local or remote. */
  onMessages(handler: (messages: ChatMessage[]) => void): { dispose(): void } {
    const listener = (): void => handler(this.messages());
    this.chatLog.observe(listener);
    return { dispose: () => this.chatLog.unobserve(listener) };
  }

  /**
   * Remove someone. Re-keys the room, tells everyone else the new key over the connections
   * that already exist, and tells the removed peer to close its copy.
   *
   * Two things this cannot do, and the UI says so: it cannot recall what they have already
   * seen, and it cannot reach a peer whose only route to us ran through them. The return
   * value names anyone who did not make it across, so they can be re-invited.
   */
  async remove(peerId: string): Promise<{ stranded: Peer[] }> {
    if (this.closed) return { stranded: [] };

    const expected = this.provider.peers().filter((p) => p.peerId && p.peerId !== peerId);
    const next = newRoomKey();
    this.seenRooms.add(this.currentKey.roomId);

    // Order matters: the new key goes out over the old room while everyone is still
    // reachable, and only then does anybody move.
    const others = this.provider.connectedPeers().filter((id) => id !== peerId);
    this.provider.sendOn("control", controlFrame(CONTROL.rekey, { room: next, exclude: peerId }), others);
    this.provider.sendOn("control", controlFrame(CONTROL.evicted, {}), peerId);

    await this.moveTo(next);

    // Give the others a moment to follow, then say who did not.
    await new Promise((r) => setTimeout(r, this.followMs));
    const arrived = new Set(this.provider.peers().map((p) => p.peerId));
    return { stranded: expected.filter((p) => !arrived.has(p.peerId)) };
  }

  private async moveTo(room: RoomKey): Promise<void> {
    this.seenRooms.add(this.currentKey.roomId);
    this.currentKey = room;
    await this.provider.moveTo(this.makeTransport(room));
    this.announce(); // our transport id changed with the room
    this.host.onChange?.();
  }

  private async onControl(payload: Uint8Array, from: string): Promise<void> {
    const kind = payload[0];
    const body = payload.subarray(1);

    if (kind === CONTROL.evicted) {
      // Only from someone we are actually connected to, and never from ourselves.
      if (from === this.provider.selfId) return;
      this.host.notify(t("collab.evicted"));
      await this.leave();
      this.host.onEvicted?.();
      return;
    }

    if (kind !== CONTROL.rekey) return;
    const message = JSON.parse(textDecoder.decode(body)) as RekeyMessage;
    if (!message.room?.roomId || this.seenRooms.has(message.room.roomId)) return;
    if (message.room.roomId === this.currentKey.roomId) return;

    // Pass it on before moving, so a peer that can only be reached through us still gets
    // it. Never back to the sender, and never to the peer being removed.
    const onward = this.provider
      .connectedPeers()
      .filter((id) => id !== from && id !== message.exclude);
    this.provider.sendOn("control", controlFrame(CONTROL.rekey, message), onward);

    await this.moveTo(message.room);
  }

  get connected(): boolean {
    return this.provider.connectedPeers().length > 0;
  }

  /** True once this peer is mirroring the shared document. */
  get editing(): boolean {
    return this.bound;
  }

  /**
   * Why this peer is not editing together, so the UI can say which it is rather than
   * guessing. Two very different situations look identical from outside.
   */
  get status(): "editing" | "unsupported" | "mismatch" | "waiting" {
    if (this.bound) return "editing";
    if (this.wrongEditor) return "mismatch";
    return this.unsupported ? "unsupported" : "waiting";
  }

  /** The editor this session is being shared through, when we are not in it. */
  get sharedEditorId(): string | null {
    return this.provider.doc.getMap<string>(META).get(META_EDITOR) ?? null;
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.binding?.unbind();
    this.binding = null;
    await this.provider.destroy();
  }
}
