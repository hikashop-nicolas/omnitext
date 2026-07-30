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
import type { CollabTransport } from "./transport";

// A Yjs provider over any CollabTransport: it carries the Yjs sync protocol and the
// awareness protocol between peers, and owns nothing else.
//
// Trystero connects every peer to every other one, so an update reaches everyone
// directly and this never relays what it receives. That is the whole reason the
// origin check below is a plain equality test rather than a routing table.

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

export class CollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly transport: CollabTransport;
  private readonly peersHandlers = new Set<PeersHandler>();
  private closed = false;

  constructor(transport: CollabTransport, doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.transport = transport;

    transport.onMessage((channel, payload, peerId) => this.receive(channel, payload, peerId));
    transport.onPeerJoin((peerId) => this.greet(peerId));
    transport.onPeerLeave(() => this.emitPeers());

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
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

  private receive(channel: "sync" | "awareness", payload: Uint8Array, peerId: string): void {
    if (this.closed) return;
    if (channel === "sync") {
      const enc = encoding.createEncoder();
      readSyncMessage(decoding.createDecoder(payload), enc, this.doc, this);
      // A step-1 is answered with a step-2; anything else leaves the encoder empty.
      if (encoding.length(enc) > 0) {
        this.transport.send("sync", encoding.toUint8Array(enc), peerId);
      }
    } else {
      applyAwarenessUpdate(this.awareness, payload, this);
    }
  }

  /** `this` as the origin marks an update as arrived-from-a-peer, so it is not echoed back. */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this || this.closed) return;
    const enc = encoding.createEncoder();
    writeUpdate(enc, update);
    this.transport.send("sync", encoding.toUint8Array(enc), null);
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

  /** Publish who we are and what we have selected. */
  setPresence(presence: Presence): void {
    this.awareness.setLocalState({ ...presence });
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
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.peersHandlers.clear();
    await this.transport.close();
  }
}
