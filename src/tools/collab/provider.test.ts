import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CollabProvider } from "./provider";
import type { Channel, CollabTransport, MessageHandler, PeerHandler } from "./transport";

// The sync and awareness wiring, tested without a network.
//
// This is the part of Phase 0 a machine can check. Whether WebRTC connects at all is a
// two-browser question and is not answerable here; what IS answerable is whether the
// protocol is wired up correctly once bytes do flow, which is where this kind of code
// usually goes wrong: an origin check that echoes updates forever, a joiner that never
// receives what was written before it arrived, presence that never propagates.

interface Node {
  id: string;
  message: MessageHandler[];
  join: PeerHandler[];
  leave: PeerHandler[];
  open: boolean;
}

/**
 * A full mesh in memory. Delivery is queued rather than immediate, so a handler that
 * sends while handling cannot recurse, and so nothing is delivered before the provider
 * has finished registering its handlers.
 */
class FakeNetwork {
  private readonly nodes = new Map<string, Node>();
  private queue: (() => void)[] = [];
  /** Sends seen, per channel, for the no-echo test. */
  readonly sent: Record<Channel, number> = { sync: 0, awareness: 0, base: 0, control: 0 };
  /** Set to drop every sync message, to prove the assertions have teeth. */
  partitioned = false;
  /** Pairs that never manage to connect, for the partial-mesh tests. */
  private readonly unlinked = new Set<string>();

  private static pair(a: string, b: string): string {
    return [a, b].sort().join("|");
  }

  /** Two peers that cannot see each other, as Trystero rooms are reported to do. */
  unlink(a: string, b: string): void {
    this.unlinked.add(FakeNetwork.pair(a, b));
  }

  private linked(a: string, b: string): boolean {
    return !this.unlinked.has(FakeNetwork.pair(a, b));
  }

  connect(id: string): CollabTransport {
    const node: Node = { id, message: [], join: [], leave: [], open: true };
    for (const other of this.nodes.values()) {
      if (!other.open || !this.linked(id, other.id)) continue;
      this.queue.push(() => other.join.forEach((h) => h(id)));
      this.queue.push(() => node.join.forEach((h) => h(other.id)));
    }
    this.nodes.set(id, node);

    const visible = (): string[] =>
      [...this.nodes.values()].filter((n) => n.open && n.id !== id && this.linked(id, n.id)).map((n) => n.id);

    return {
      selfId: id,
      send: (channel, payload, target) => {
        this.sent[channel]++;
        if (this.partitioned && channel === "sync") return;
        const copy = payload.slice(); // the encoder reuses its buffer
        const requested = target === null ? visible() : Array.isArray(target) ? target : [target];
        for (const to of requested.filter((t) => this.linked(id, t))) {
          this.queue.push(() => {
            const n = this.nodes.get(to);
            if (n?.open) n.message.forEach((h) => h(channel, copy, id));
          });
        }
      },
      onMessage: (h) => void node.message.push(h),
      onPeerJoin: (h) => void node.join.push(h),
      onPeerLeave: (h) => void node.leave.push(h),
      peers: visible,
      close: async () => {
        node.open = false;
        this.nodes.delete(id);
        for (const other of this.nodes.values()) {
          this.queue.push(() => other.leave.forEach((h) => h(id)));
        }
      },
    };
  }

  /** Run queued deliveries until nothing more is produced. */
  async settle(): Promise<void> {
    for (let round = 0; this.queue.length; round++) {
      if (round > 1000) throw new Error("network never settled: a message is echoing");
      const batch = this.queue;
      this.queue = [];
      for (const run of batch) run();
      await Promise.resolve();
    }
  }
}

const text = (p: CollabProvider): string => p.doc.getText("t").toString();

describe("CollabProvider", () => {
  it("carries an edit from one peer to the other", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    a.doc.getText("t").insert(0, "hello");
    await net.settle();

    expect(text(b)).toBe("hello");
  });

  it("converges when both peers edit at once", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    // Neither has seen the other's insert when it makes its own.
    a.doc.getText("t").insert(0, "AAA");
    b.doc.getText("t").insert(0, "BBB");
    await net.settle();

    expect(text(a)).toBe(text(b));
    expect(text(a)).toHaveLength(6);
    expect(text(a)).toContain("AAA");
    expect(text(a)).toContain("BBB");
  });

  it("gives a late joiner what was written before it arrived", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    await net.settle();
    a.doc.getText("t").insert(0, "written earlier");
    await net.settle();

    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    expect(text(b)).toBe("written earlier");
  });

  it("converges across three peers", async () => {
    const net = new FakeNetwork();
    const peers = ["a", "b", "c"].map((id) => new CollabProvider(net.connect(id)));
    await net.settle();

    peers.forEach((p, i) => p.doc.getText("t").insert(0, `${i}`));
    await net.settle();

    const [first] = peers.map(text);
    for (const p of peers) expect(text(p)).toBe(first);
    expect(first).toHaveLength(3);
  });

  // Trystero rooms do not reliably form a full mesh. Two open reports say so
  // (dmotz/trystero#161 and #151): in a room of three, A and C connect, B and C connect,
  // and A and B never do. So an update must reach everyone the sender cannot see, by
  // going through whoever can see both.
  it("converges when the mesh is partial", async () => {
    const net = new FakeNetwork();
    net.unlink("a", "b");
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    const c = new CollabProvider(net.connect("c"));
    await net.settle();

    expect(a.doc.clientID).not.toBe(b.doc.clientID);
    a.doc.getText("t").insert(0, "from A");
    await net.settle();

    expect(text(c)).toBe("from A"); // directly
    expect(text(b)).toBe("from A"); // only reachable through C
  });

  it("converges when a partial mesh is also edited from the far side", async () => {
    const net = new FakeNetwork();
    net.unlink("a", "b");
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    const c = new CollabProvider(net.connect("c"));
    await net.settle();

    a.doc.getText("t").insert(0, "AAA");
    b.doc.getText("t").insert(0, "BBB");
    await net.settle();

    expect(text(a)).toBe(text(b));
    expect(text(b)).toBe(text(c));
    expect(text(a)).toHaveLength(6);
  });

  // Relaying is not enough on its own: a message lost on a working link is never resent,
  // because Yjs updates are deltas and nobody notices the gap. Exchanging state vectors
  // heals it whatever the cause. A resync is a pull, so it is the peer that fell behind
  // whose request repairs it; in a real session every peer runs the same timer.
  it("heals a dropped update when the peers compare notes again", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    net.partitioned = true;
    a.doc.getText("t").insert(0, "lost in transit");
    await net.settle();
    expect(text(b)).toBe("");

    net.partitioned = false;
    b.requestResync();
    await net.settle();
    expect(text(b)).toBe("lost in transit");
  });

  it("heals in whichever direction the gap is, once every peer has ticked", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    net.partitioned = true;
    a.doc.getText("t").insert(0, "A wrote this");
    b.doc.getText("t").insert(0, "B wrote this");
    await net.settle();
    expect(text(a)).not.toBe(text(b));

    net.partitioned = false;
    a.requestResync();
    b.requestResync();
    await net.settle();

    expect(text(a)).toBe(text(b));
    expect(text(a)).toContain("A wrote this");
    expect(text(a)).toContain("B wrote this");
  });

  it("resyncs on its own timer, with no help from the caller", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"), new Y.Doc(), 5);
    const b = new CollabProvider(net.connect("b"), new Y.Doc(), 5);
    await net.settle();

    net.partitioned = true;
    a.doc.getText("t").insert(0, "dropped");
    await net.settle();
    expect(text(b)).toBe("");

    net.partitioned = false;
    await new Promise((r) => setTimeout(r, 30)); // let the 5ms tickers fire
    await net.settle();

    expect(text(b)).toBe("dropped");
    await a.destroy();
    await b.destroy();
  });

  it("does not echo a remote update back onto the network", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    const before = net.sent.sync;
    a.doc.getText("t").insert(0, "x");
    await net.settle();

    // One broadcast from A. B applies it and must stay quiet: were the origin check
    // wrong, settle() would have thrown on the echo long before this assertion.
    expect(net.sent.sync - before).toBe(1);
    expect(text(b)).toBe("x");
  });

  it("propagates presence, and withdraws it on destroy", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    a.setPresence({ name: "Ada", colour: "#f00" });
    b.setPresence({ name: "Linus", colour: "#00f" });
    await net.settle();

    expect(b.peers().map((p) => p.name)).toEqual(["Ada"]);
    expect(a.peers().map((p) => p.name)).toEqual(["Linus"]);

    await a.destroy();
    await net.settle();
    expect(b.peers()).toEqual([]);
  });

  it("reports a peer list change to its subscribers", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const seen: string[][] = [];
    a.onPeersChanged((peers) => seen.push(peers.map((p) => p.name)));

    const b = new CollabProvider(net.connect("b"));
    b.setPresence({ name: "Grace", colour: "#0f0" });
    await net.settle();

    expect(seen.at(-1)).toEqual(["Grace"]);
  });

  // The check on the checks: with sync messages dropped, the peers must NOT converge.
  // Without this, every assertion above would still pass if the transport silently
  // delivered nothing and both documents simply stayed empty together.
  it("does not converge when the network drops sync messages", async () => {
    const net = new FakeNetwork();
    net.partitioned = true;
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    a.doc.getText("t").insert(0, "hello");
    await net.settle();

    expect(text(a)).toBe("hello");
    expect(text(b)).toBe("");
  });

  it("shares one document between a provider and a caller-supplied Y.Doc", async () => {
    const net = new FakeNetwork();
    const doc = new Y.Doc();
    const a = new CollabProvider(net.connect("a"), doc);
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    doc.getText("t").insert(0, "from the caller's doc");
    await net.settle();

    expect(a.doc).toBe(doc);
    expect(text(b)).toBe("from the caller's doc");
  });
});

describe("presence shape", () => {
  // Off-the-shelf Yjs editor bindings look for `user.name` and `user.color` specifically.
  // Without them, y-codemirror.next labels every remote cursor "Anonymous", which is what
  // it did the first time this ran in the app.
  it("publishes the user field the editor bindings read", async () => {
    const net = new FakeNetwork();
    const a = new CollabProvider(net.connect("a"));
    const b = new CollabProvider(net.connect("b"));
    await net.settle();

    a.setPresence({ name: "Ada", colour: "#e5484d" });
    await net.settle();

    const seen = b.awareness.getStates().get(a.doc.clientID) as
      | { user?: { name?: string; color?: string } }
      | undefined;
    expect(seen?.user).toEqual({ name: "Ada", color: "#e5484d" });
    // And our own shape still works, so the peer list is unaffected.
    expect(b.peers().map((p) => p.name)).toEqual(["Ada"]);
  });
});
