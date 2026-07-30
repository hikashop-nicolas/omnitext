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
  /** Whatever the editor's binding wants to publish. Opaque here, by design. */
  selection?: unknown;
}

export interface Peer extends Presence {
  clientId: number;
}

export type PeersHandler = (peers: Peer[]) => void;

/** How often peers compare state vectors. Cheap: a state vector is small, and a match costs nothing. */
export const RESYNC_MS = 15_000;
/** y-protocols sync message types; only step 1 carries no content. */
const SYNC_STEP_1 = 0;
/** How long a joiner waits to hear the session's contents before giving up on waiting. */
export const SYNC_WAIT_MS = 8_000;

export class CollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly transport: CollabTransport;
  private readonly peersHandlers = new Set<PeersHandler>();
  private closed = false;
  /** The peer an update is currently arriving from, so it is not relayed straight back. */
  private applyingFrom: string | null = null;
  private readonly ticker: ReturnType<typeof setInterval>;
  private readonly firstContent: Promise<void>;
  private markSynced: () => void = () => undefined;
  private hasContent = false;

  constructor(transport: CollabTransport, doc: Y.Doc = new Y.Doc(), resyncMs: number = RESYNC_MS) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.transport = transport;
    this.firstContent = new Promise<void>((resolve) => {
      this.markSynced = resolve;
    });

    transport.onMessage((channel, payload, peerId) => this.receive(channel, payload, peerId));
    transport.onPeerJoin((peerId) => this.greet(peerId));
    transport.onPeerLeave(() => this.emitPeers());

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);

    this.ticker = setInterval(() => this.requestResync(), resyncMs);
    // Node only, and only so a test process is not held open by the interval.
    (this.ticker as { unref?: () => void }).unref?.();
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
    if (this.closed || channel === "base") return; // the base file is the session's business, not the CRDT's
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
      applyAwarenessUpdate(this.awareness, payload, this);
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
    if (origin !== this) {
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      this.transport.send("awareness", encodeAwarenessUpdate(this.awareness, changed), null);
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
      out.push({ clientId, name: s.name, colour: s.colour ?? "#888", selection: s.selection });
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
