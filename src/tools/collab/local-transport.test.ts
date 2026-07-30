import { describe, expect, it } from "vitest";
import { CollabProvider } from "./provider";
import { localTransport } from "./local-transport";

// The same-browser transport, tested against the real BroadcastChannel (Node has one).
//
// It has to satisfy the same contract as the Trystero one, because the session and every
// binding are written against that contract and nothing else. The point of the last test
// is exactly that: run the real provider over it and check two documents converge.

const settle = async (ms = 60): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
};

let n = 0;
const room = (): string => `test-room-${n++}-${Math.random().toString(36).slice(2)}`;

describe("the same-browser transport", () => {
  it("finds the other tab without any relay", async () => {
    const id = room();
    const a = localTransport(id);
    const joinedByA: string[] = [];
    a.onPeerJoin((peer) => joinedByA.push(peer));

    const b = localTransport(id);
    const joinedByB: string[] = [];
    b.onPeerJoin((peer) => joinedByB.push(peer));

    await settle();
    expect(joinedByA).toEqual([b.selfId]);
    expect(joinedByB).toEqual([a.selfId]);
    expect(a.peers()).toEqual([b.selfId]);

    await a.close();
    await b.close();
  });

  it("keeps different rooms apart", async () => {
    const a = localTransport(room());
    const b = localTransport(room());
    const seen: string[] = [];
    a.onPeerJoin((p) => seen.push(p));
    await settle();
    expect(seen).toEqual([]);
    await a.close();
    await b.close();
  });

  it("delivers to everyone, to one peer, and to a chosen few", async () => {
    const id = room();
    const [a, b, c] = [localTransport(id), localTransport(id), localTransport(id)];
    const got: Record<string, number[][]> = { b: [], c: [] };
    b.onMessage((_ch, payload) => got.b.push([...payload]));
    c.onMessage((_ch, payload) => got.c.push([...payload]));
    await settle();

    a.send("sync", new Uint8Array([1]), null); // everyone
    a.send("sync", new Uint8Array([2]), b.selfId); // one
    a.send("sync", new Uint8Array([3]), [c.selfId]); // a chosen few
    await settle();

    expect(got.b).toEqual([[1], [2]]);
    expect(got.c).toEqual([[1], [3]]);

    await Promise.all([a.close(), b.close(), c.close()]);
  });

  it("keeps the channels apart and the bytes intact", async () => {
    const id = room();
    const a = localTransport(id);
    const b = localTransport(id);
    const seen: [string, number[]][] = [];
    b.onMessage((channel, payload) => seen.push([channel, [...payload]]));
    await settle();

    a.send("sync", new Uint8Array([1, 2, 3]), null);
    a.send("awareness", new Uint8Array([9]), null);
    a.send("base", new Uint8Array([255, 0]), null);
    await settle();

    expect(seen).toEqual([
      ["sync", [1, 2, 3]],
      ["awareness", [9]],
      ["base", [255, 0]],
    ]);
    await a.close();
    await b.close();
  });

  it("tells the others when a tab leaves", async () => {
    const id = room();
    const a = localTransport(id);
    const b = localTransport(id);
    const gone: string[] = [];
    a.onPeerLeave((p) => gone.push(p));
    await settle();

    await b.close();
    await settle();
    expect(gone).toEqual([b.selfId]);
    expect(a.peers()).toEqual([]);
    await a.close();
  });

  it("never delivers a peer its own message", async () => {
    const id = room();
    const a = localTransport(id);
    const b = localTransport(id);
    const mine: number[][] = [];
    a.onMessage((_ch, payload) => mine.push([...payload]));
    await settle();

    a.send("sync", new Uint8Array([7]), null);
    await settle();
    expect(mine).toEqual([]);
    await a.close();
    await b.close();
  });

  // The one that matters: the real provider, over this transport, converging. If this
  // passes, everything above the transport can be tested at this speed.
  it("carries a real session, and converges", async () => {
    const id = room();
    const a = new CollabProvider(localTransport(id));
    const b = new CollabProvider(localTransport(id));
    await settle();

    a.setPresence({ name: "Ada", colour: "#f00" });
    a.doc.getText("t").insert(0, "hello ");
    await settle();
    b.doc.getText("t").insert(b.doc.getText("t").length, "world");
    await settle();

    expect(a.doc.getText("t").toString()).toBe("hello world");
    expect(b.doc.getText("t").toString()).toBe("hello world");
    expect(b.peers().map((p) => p.name)).toEqual(["Ada"]);

    await a.destroy();
    await b.destroy();
  });
});
