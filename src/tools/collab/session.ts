import type * as Y from "yjs";
import { t } from "../../i18n";
import { debug } from "../../core/debug";
import { BUILD_ID } from "../../build-id";
import type { CollabBinding } from "../../core/types";
import { BaseTransfer, type BaseDoc } from "./base";
import { newRoomKey, type RoomKey } from "./link";
import { CollabProvider, type Peer } from "./provider";
import { localTransport } from "./local-transport";
import { trysteroTransport, type CollabTransport } from "./transport";
import { turnServers } from "./turn";
import { BlobStore } from "./blobs";
import { getSettings } from "../../settings";

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
const CONTROL = { rekey: 1, evicted: 2, propose: 3, ordered: 4 } as const;

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
/** Which build of the app started the session. See BUILD_ID for why this is checked. */
const META_BUILD = "build";

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
  /** The editor refused something because this session is running. */
  onBlocked?(reason: "structural"): void;
  /** We were removed from the session: close the document, per the product decision. */
  onEvicted?(): void;
  /** Called whenever the peer list or connection state changes, for the UI. */
  onChange?(): void;
}

/**
 * Operations that cannot be merged and must instead be put in a single order.
 *
 * The session knows nothing about what they are: a binding proposes one, the peer that
 * started the room stamps it with a sequence number, and every peer is handed the same
 * operations in the same order. Deciding what an operation means, and what to do about one
 * that arrives early, belongs to the binding.
 */
export interface OrderedOps {
  propose(op: unknown): void;
  onOrdered(handler: (op: unknown, seq: number) => void): { dispose(): void };
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
  /** When a joiner starts saying it is taking a while, and when it gives up. Test seams. */
  slowMs?: number;
  unreachableMs?: number;
}

/**
 * How a joiner's attempt to reach the session is going.
 *
 * There is no relay configured, so two peers whose networks cannot be joined directly do
 * not fall back to anything: they simply never connect. Trystero cannot tell us that has
 * happened, so this is inferred from time passing, which is honest about what it is. The
 * point is that the one unacceptable outcome, spinning on "connecting" forever with no
 * explanation, does not happen.
 */
export type Reachability = "connecting" | "slow" | "unreachable" | "connected";

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
  localModeRequested()
    ? localTransport(key.roomId)
    : trysteroTransport({
        roomId: key.roomId,
        secret: key.secret,
        // Only if it is complete and well formed; a half-filled one is treated as absent
        // rather than handed to the browser to fail on later.
        turnServers: turnServers(getSettings().turn).servers,
      });

export class CollabSession {
  private currentKey: RoomKey;
  /** True for the peer that started the room: the only one that seeds the shared doc. */
  readonly isHost: boolean;
  readonly readOnly: boolean;
  readonly provider: CollabProvider;
  private readonly base: BaseTransfer;
  private readonly blobs: BlobStore;
  private readonly host: SessionHost;
  private readonly makeTransport: (key: RoomKey) => CollabTransport;
  private binding: CollabBinding | null = null;
  private bound = false;
  private closed = false;
  private unsupported = false;
  private wrongEditor = false;
  private wrongBuild = false;
  private me: { name: string; colour: string };
  /** True while the name is one we picked, so it may be renumbered as peers appear. */
  private autoName: boolean;
  /** Rooms we have already moved through, so a stale re-key cannot bounce us back. */
  private readonly seenRooms = new Set<string>();
  private readonly followMs: number;
  private reach: Reachability = "connecting";
  private reachTimers: ReturnType<typeof setTimeout>[] = [];
  /** Host only: the next sequence number to hand out. */
  private nextSeq = 1;
  private readonly orderedHandlers = new Set<(op: unknown, seq: number) => void>();

  constructor(host: SessionHost, opts: SessionOptions) {
    this.host = host;
    this.isHost = !opts.key;
    this.currentKey = opts.key ?? newRoomKey();
    this.readOnly = opts.readOnly ?? false;
    this.autoName = !opts.name.trim();
    this.me = { name: opts.name.trim() || `${GUEST} 1`, colour: opts.colour };
    this.followMs = opts.followMs ?? 2_000;
    this.makeTransport = opts.makeTransport ?? defaultTransport;

    debug("collab", this.isHost ? "starting a room" : "joining a room", () => ({
      room: this.currentKey.roomId,
      readOnly: this.readOnly,
    }));
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

    this.blobs = new BlobStore({
      send: (payload, target) => this.provider.sendOn("blob", payload, target),
      // Read each time rather than captured: a peer that joined after an image was pasted
      // is still somewhere to ask.
      peers: () => this.provider.peers().map((p) => p.peerId).filter((id): id is string => !!id),
    });
    this.provider.onChannel("blob", (payload, peerId) => void this.blobs.receive(payload, peerId));
    this.provider.onChannel("base", (payload, peerId) => void this.base.receive(payload, peerId));
    this.provider.onChannel("control", (payload, peerId) => void this.onControl(payload, peerId));
    // Only the peer that started the room serves the base; joiners never offer theirs.
    if (this.isHost) this.provider.onPeerJoined((peerId) => void this.base.offerTo(peerId));
    this.provider.onPeersChanged(() => {
      this.renumber();
      if (this.provider.peers().length) this.settleReach("connected");
      this.host.onChange?.();
    });

    // Only a joiner. A host waiting for an invitation to be used is waiting on a person,
    // and there is no length of time after which that has "failed".
    if (!this.isHost) {
      const slow = opts.slowMs ?? 20_000;
      const unreachable = opts.unreachableMs ?? 60_000;
      this.reachTimers.push(setTimeout(() => this.settleReach("slow"), slow));
      this.reachTimers.push(setTimeout(() => this.settleReach("unreachable"), unreachable));
    }
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
    for (const watcher of this.meWatchers) watcher({ ...this.me });
  }

  /** Told when our own name or colour moves: a clash renumber, or a rename mid-session. */
  private readonly meWatchers = new Set<(me: { name: string; colour: string }) => void>();

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
      meta.set(META_BUILD, BUILD_ID);
    } else {
      const theirs = meta.get(META_EDITOR);
      if (theirs && mine && theirs !== mine) {
        debug("collab", "refusing to bind: different editor", () => ({ mine, theirs }));
        this.wrongEditor = true;
        this.host.notify(t("collab.wrongEditor"));
        this.host.onChange?.();
        return;
      }
      // Same code on both sides, or edits keyed by position mean different things. The one
      // that matters most is the PDF editor, whose paragraph numbering comes from a
      // heuristic that a different build may run differently, so "paragraph 3" would land
      // somewhere else. Refusing is the honest answer: the alternative is two documents
      // that quietly disagree.
      const theirBuild = meta.get(META_BUILD);
      if (theirBuild && theirBuild !== BUILD_ID) {
        debug("collab", "refusing to bind: different build", () => ({ mine: BUILD_ID, theirs: theirBuild }));
        this.wrongBuild = true;
        this.host.notify(t("collab.wrongBuild"));
        this.host.onChange?.();
        return;
      }
    }
    this.wrongEditor = false;
    this.wrongBuild = false;

    this.binding = binding;
    this.bound = true;
    binding.onBlocked?.((reason) => this.host.onBlocked?.(reason));
    await binding.bind({
      doc: this.provider.doc,
      awareness: this.provider.awareness,
      seed: this.isHost,
      readOnly: this.readOnly,
      blobs: this.blobs,
      ordered: this.ordered,
      me: {
        name: this.me.name,
        colour: this.me.colour,
        onChanged: (handler) => {
          this.meWatchers.add(handler);
          return { dispose: () => void this.meWatchers.delete(handler) };
        },
      },
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

  /**
   * The ordering facility a binding uses for operations that cannot merge. Proposing from
   * the host applies immediately; from anyone else it asks the host, so there is one order
   * and it is the same for everyone.
   */
  get ordered(): OrderedOps {
    return {
      propose: (op) => {
        if (this.closed) return;
        if (this.isHost) this.publishOrdered(op);
        else this.provider.sendOn("control", controlFrame(CONTROL.propose, { op }), null);
      },
      onOrdered: (handler) => {
        this.orderedHandlers.add(handler);
        return { dispose: () => this.orderedHandlers.delete(handler) };
      },
    };
  }

  /** Host only: stamp an operation and give it to everyone, ourselves included. */
  private publishOrdered(op: unknown): void {
    const seq = this.nextSeq++;
    debug("collab", `ordering operation ${seq}`, () => op);
    this.provider.sendOn("control", controlFrame(CONTROL.ordered, { op, seq }), null);
    for (const h of this.orderedHandlers) h(op, seq);
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

    if (kind === CONTROL.propose) {
      // Only the host orders. A proposal reaching anyone else is ignored rather than
      // applied locally, or two peers would each invent their own sequence.
      if (!this.isHost) return;
      const { op } = JSON.parse(textDecoder.decode(body)) as { op: unknown };
      this.publishOrdered(op);
      return;
    }
    if (kind === CONTROL.ordered) {
      const { op, seq } = JSON.parse(textDecoder.decode(body)) as { op: unknown; seq: number };
      debug("collab", `received ordered operation ${seq}`, () => op);
      for (const h of this.orderedHandlers) h(op, seq);
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
  /** How the attempt to reach the others is going. Always "connected" once one has been. */
  get reachability(): Reachability {
    return this.reach;
  }

  private settleReach(next: Reachability): void {
    if (this.closed) return;
    // Reaching someone cancels the timers, which is what makes it stick: nothing re-arms
    // them, so a peer leaving later cannot turn a connection that happened into a failure.
    if (next === "connected") for (const t of this.reachTimers) clearTimeout(t);
    if (this.reach === next) return;
    this.reach = next;
    debug("collab", `reachability: ${next}`);
    this.host.onChange?.();
  }

  get status(): "editing" | "unsupported" | "mismatch" | "oldBuild" | "waiting" {
    if (this.bound) return "editing";
    if (this.wrongEditor) return "mismatch";
    if (this.wrongBuild) return "oldBuild";
    return this.unsupported ? "unsupported" : "waiting";
  }

  /** The editor this session is being shared through, when we are not in it. */
  get sharedEditorId(): string | null {
    return this.provider.doc.getMap<string>(META).get(META_EDITOR) ?? null;
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    for (const t of this.reachTimers) clearTimeout(t);
    this.blobs.dispose();
    this.closed = true;
    this.binding?.unbind();
    this.binding = null;
    await this.provider.destroy();
  }
}
