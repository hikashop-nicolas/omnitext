import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { readSyncMessage, writeSyncStep1, writeUpdate } from "y-protocols/sync";
import type { Channel, CollabTransport } from "./transport";
import { DebugTally, debug } from "../../core/debug";

// A Yjs provider over any CollabTransport: it carries the Yjs sync protocol and the
// awareness protocol between peers, and owns nothing else.
//
// It does NOT assume the mesh is complete. Trystero rooms are reported to leave pairs
// unconnected (dmotz/trystero#161, #151): A sees C, B sees C, A and B never see each
// other. So two things guard against divergence, and the tests cover both:
//
//   1. A remote update that changed our document is passed on to every peer except the
//      one it came from, which carries it across a hole in the mesh.
//   2. State vectors are exchanged periodically. Relaying cannot help with a message
//      lost on a working link, because Yjs updates are deltas and nobody notices a gap;
//      comparing state vectors heals it whatever the cause.

export interface Presence {
  name: string;
  colour: string;
  /** This peer's transport id. It is how one peer can name another to remove it. */
  peerId?: string;
  /** Whatever the editor's binding wants to publish. Opaque here, by design. */
  selection?: unknown;
}

export interface Peer extends Presence {
  clientId: number;
}

export type PeersHandler = (peers: Peer[]) => void;

/** How often peers compare state vectors. Cheap: a state vector is small, and a match costs nothing. */
export const RESYNC_MS = 15_000;

/** Carried by the provider, interpreted by the session: not CRDT traffic. */
const SESSION_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(["base", "control", "blob"]);
/** y-protocols sync message types; only step 1 carries no content. */
const SYNC_STEP_1 = 0;
/** How long a joiner waits to hear the session's contents before giving up on waiting. */
export const SYNC_WAIT_MS = 8_000;

export class CollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** Mutable: a session can move to a new room, which swaps the network under it. */
  private transport: CollabTransport;
  private readonly peersHandlers = new Set<PeersHandler>();
  /** Subscribers to channels the provider carries but does not interpret. */
  private readonly channelHandlers = new Map<Channel, Set<(payload: Uint8Array, peerId: string) => void>>();
  private readonly joinHandlers = new Set<(peerId: string) => void>();
  private closed = false;
  /** The peer an update is currently arriving from, so it is not relayed straight back. */
  private applyingFrom: string | null = null;
  private readonly ticker: ReturnType<typeof setInterval>;
  private readonly firstContent: Promise<void>;
  private markSynced: () => void = () => undefined;
  private hasContent = false;
  /** Set while pruning presence locally, so the clean-up is not broadcast. */
  private quietAwareness = false;
  /** Sync traffic is per keystroke: a line each drowns the console, so it is counted. */
  private readonly tally = new DebugTally("wire");

  constructor(transport: CollabTransport, doc: Y.Doc = new Y.Doc(), resyncMs: number = RESYNC_MS) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.transport = transport;
    this.firstContent = new Promise<void>((resolve) => {
      this.markSynced = resolve;
    });

    this.wire(transport);

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);

    this.ticker = setInterval(() => this.requestResync(), resyncMs);
    // Node only, and only so a test process is not held open by the interval.
    (this.ticker as { unref?: () => void }).unref?.();
  }

  private wire(t: CollabTransport): void {
    t.onMessage((channel, payload, peerId) => this.receive(channel, payload, peerId));
    t.onPeerJoin((peerId) => {
      debug("collab", "peer joined", () => peerId);
      this.tally.report("wire totals so far");
      this.greet(peerId);
      for (const h of this.joinHandlers) h(peerId);
    });
    t.onPeerLeave((peerId) => {
      debug("collab", "peer left", () => peerId);
      this.emitPeers();
    });
  }

  /** This peer's transport id, which is how the others address it. */
  get selfId(): string {
    return this.transport.selfId;
  }

  /** Who we are connected to right now, by transport id. */
  connectedPeers(): string[] {
    return this.transport.peers();
  }

  /**
   * Send on a channel the provider carries but does not interpret: the base file, and the
   * session's own control messages. Routed through here so a move to a new room does not
   * leave a caller holding a closed transport.
   */
  sendOn(channel: Channel, payload: Uint8Array, target: string | string[] | null): void {
    if (this.closed) return;
    debug("wire", `sending on ${channel}`, () => ({ bytes: payload.length, target }));
    if (Array.isArray(target) && !target.length) return;
    this.transport.send(channel, payload, target);
  }

  onChannel(
    channel: Channel,
    handler: (payload: Uint8Array, peerId: string) => void,
  ): { dispose(): void } {
    const set = this.channelHandlers.get(channel) ?? new Set();
    this.channelHandlers.set(channel, set);
    set.add(handler);
    return { dispose: () => set.delete(handler) };
  }

  onPeerJoined(handler: (peerId: string) => void): { dispose(): void } {
    this.joinHandlers.add(handler);
    return { dispose: () => this.joinHandlers.delete(handler) };
  }

  /**
   * Move to a different room, keeping the document, the presence channel and whatever the
   * editor has bound to. Only the network underneath is replaced, so nothing is re-seeded
   * and no content is re-sent from scratch.
   */
  async moveTo(next: CollabTransport): Promise<void> {
    if (this.closed) return;
    const previous = this.transport;
    this.transport = next;
    this.wire(next);

    // Whoever was in the old room is not here, and should not linger for the awareness
    // timeout. Anyone who followed us re-announces on connecting. This clean-up is purely
    // local: broadcasting it would tell the new room to forget peers that are in it.
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    if (others.length) {
      this.quietAwareness = true;
      try {
        removeAwarenessStates(this.awareness, others, "moved");
      } finally {
        this.quietAwareness = false;
      }
    }

    await previous.close().catch(() => undefined);
    this.emitPeers();
  }

  /**
   * Ask every peer for whatever this document is missing. It is a pull, not a push: it
   * repairs the caller. That is enough because every peer runs the same timer, so a gap
   * in either direction closes within one interval.
   */
  requestResync(): void {
    if (this.closed || !this.transport.peers().length) return;
    const enc = encoding.createEncoder();
    writeSyncStep1(enc, this.doc);
    this.transport.send("sync", encoding.toUint8Array(enc), null);
  }

  /** A peer arrived: ask what it already has, and tell it we are here. */
  private greet(peerId: string): void {
    const enc = encoding.createEncoder();
    writeSyncStep1(enc, this.doc);
    this.transport.send("sync", encoding.toUint8Array(enc), peerId);

    const known = [...this.awareness.getStates().keys()];
    if (known.length) {
      this.transport.send("awareness", encodeAwarenessUpdate(this.awareness, known), peerId);
    }
    this.emitPeers();
  }

  private receive(channel: Channel, payload: Uint8Array, peerId: string): void {
    if (this.closed) return;
    this.tally.add(`in:${channel}`);
    if (channel !== "sync" && channel !== "awareness") {
      debug("wire", `received on ${channel}`, () => ({ bytes: payload.length, from: peerId }));
    }
    // Channels the session owns rather than the CRDT. Listed in one place because they
    // are dispatched by name: a channel missing from here is delivered nowhere, silently,
    // and looks from the outside like a peer that never answers.
    if (SESSION_CHANNELS.has(channel)) {
      for (const h of this.channelHandlers.get(channel) ?? []) h(payload, peerId);
      return;
    }
    if (channel === "sync") {
      const enc = encoding.createEncoder();
      // Applying runs the doc-update handler synchronously, which reads this to know
      // where the update came from.
      this.applyingFrom = peerId;
      let kind = SYNC_STEP_1;
      try {
        kind = readSyncMessage(decoding.createDecoder(payload), enc, this.doc, this);
      } finally {
        this.applyingFrom = null;
      }
      // A step-1 is only a question. Content arrives as a step-2 or an update, and that
      // is the moment a joiner may safely adopt the shared document.
      if (kind !== SYNC_STEP_1 && !this.hasContent) {
        this.hasContent = true;
        this.markSynced();
      }
      // A step-1 is answered with a step-2; anything else leaves the encoder empty.
      if (encoding.length(enc) > 0) {
        this.transport.send("sync", encoding.toUint8Array(enc), peerId);
      }
    } else {
      this.applyingFrom = peerId;
      try {
        applyAwarenessUpdate(this.awareness, payload, this);
      } finally {
        this.applyingFrom = null;
      }
    }
  }

  /** `this` as the origin marks an update as arrived-from-a-peer rather than made here. */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.closed) return;
    const enc = encoding.createEncoder();
    writeUpdate(enc, update);
    const payload = encoding.toUint8Array(enc);

    if (origin !== this) {
      this.transport.send("sync", payload, null); // our own edit: tell everyone
      return;
    }
    // A remote update that genuinely changed the document: pass it on, in case a peer we
    // can see cannot see the sender. Yjs ignores an update it already has, so this dies
    // out rather than circulating.
    const onward = this.transport.peers().filter((p) => p !== this.applyingFrom);
    if (onward.length) this.transport.send("sync", payload, onward);
  };

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (!this.quietAwareness && changed.length) {
      const update = encodeAwarenessUpdate(this.awareness, changed);
      if (origin !== this) {
        this.transport.send("awareness", update, null); // ours: tell everyone
      } else {
        // Arrived from a peer and genuinely changed something, so pass it on: without
        // this, a partial mesh leaves people invisible to each other, and you cannot
        // remove someone you cannot see. Stale updates change nothing, so it dies out.
        const onward = this.transport.peers().filter((p) => p !== this.applyingFrom);
        if (onward.length) this.transport.send("awareness", update, onward);
      }
    }
    this.emitPeers();
  };

  /**
   * Publish who we are and what we have selected.
   *
   * The `user` field is duplication with a reason: every off-the-shelf Yjs editor binding
   * (y-codemirror.next among them) looks for exactly `user.name` and `user.color`, and
   * labels remote cursors "Anonymous" without it.
   */
  setPresence(presence: Presence): void {
    this.awareness.setLocalState({
      ...presence,
      user: { name: presence.name, color: presence.colour },
    });
  }

  /** True once something from a peer has actually been applied to this document. */
  get synced(): boolean {
    return this.hasContent;
  }

  /**
   * Resolves once the session's contents have arrived, or after a timeout if nobody
   * answers. A joiner must wait for this before adopting the shared document: adopting an
   * empty one would blank the file it already had open.
   */
  whenSynced(ms: number = SYNC_WAIT_MS): Promise<void> {
    if (this.hasContent) return Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      this.firstContent,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]).then(() => clearTimeout(timer));
  }

  /** Everyone but us, as the awareness protocol currently sees them. */
  peers(): Peer[] {
    const out: Peer[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.doc.clientID) continue;
      const s = state as Partial<Presence>;
      if (!s || typeof s.name !== "string") continue; // a peer that has not introduced itself yet
      out.push({ clientId, name: s.name, colour: s.colour ?? "#888", peerId: s.peerId, selection: s.selection });
    }
    return out.sort((a, b) => a.clientId - b.clientId);
  }

  onPeersChanged(handler: PeersHandler): { dispose(): void } {
    this.peersHandlers.add(handler);
    return { dispose: () => this.peersHandlers.delete(handler) };
  }

  private emitPeers(): void {
    if (this.closed) return;
    const peers = this.peers();
    for (const h of this.peersHandlers) h(peers);
  }

  async destroy(): Promise<void> {
    if (this.closed) return;
    // Announce the departure first, so peers drop us now rather than after the 30s
    // awareness timeout.
    removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.closed = true;
    clearInterval(this.ticker);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.peersHandlers.clear();
    await this.transport.close();
  }
}
