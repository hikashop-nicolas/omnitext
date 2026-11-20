import { beforeEach, describe, expect, it, vi } from "vitest";

// The Trystero adapter, with Trystero itself faked.
//
// The provider tests cover the protocol; these cover the seam, which is where the
// assumptions live: that a hook may have more than one subscriber, that a targeted send
// really is targeted, and that the room is opened with the secret as its password.

type Ctx = { peerId: string };
interface FakeAction {
  send: ReturnType<typeof vi.fn>;
  onMessage: (h: (data: unknown, ctx: Ctx) => void) => () => void;
  fire: (data: unknown, ctx: Ctx) => void;
}

const actions = new Map<string, FakeAction>();
let peerJoin: ((ctx: Ctx) => void) | null = null;
let peerLeave: ((ctx: Ctx) => void) | null = null;
const room = {
  makeAction: vi.fn((ns: string) => {
    let handler: ((data: unknown, ctx: Ctx) => void) | null = null;
    const action: FakeAction = {
      send: vi.fn(async () => undefined),
      onMessage: (h) => ((handler = h), () => undefined),
      fire: (data, ctx) => handler?.(data, ctx),
    };
    actions.set(ns, action);
    return action;
  }),
  onPeerJoin: (h: (ctx: Ctx) => void) => ((peerJoin = h), () => undefined),
  onPeerLeave: (h: (ctx: Ctx) => void) => ((peerLeave = h), () => undefined),
  getSelf: vi.fn(async () => ({ peerId: "me" })),
  getPeers: vi.fn(() => ({ alice: {}, bob: {} })),
  leave: vi.fn(async () => undefined),
};
const joinRoom = vi.fn(() => room);

vi.mock("trystero", () => ({
  joinRoom: (...a: unknown[]) => joinRoom(...(a as [])),
}));

const { trysteroTransport, APP_ID } = await import("./transport");

beforeEach(() => {
  actions.clear();
  joinRoom.mockClear();
  room.makeAction.mockClear();
  room.leave.mockClear();
  peerJoin = peerLeave = null;
});

const open = () => trysteroTransport({ roomId: "r", secret: "s3cret" });

describe("trysteroTransport", () => {
  it("opens the room with the secret as its password", () => {
    open();
    const [config, roomId] = joinRoom.mock.calls[0] as unknown as [{ appId: string; password: string; identity: string }, string];
    expect(config.password).toBe("s3cret");
    expect(config.identity).toBe("none"); // nothing kept once the session ends
    expect(config.appId).toBe(APP_ID);
    expect(roomId).toBe("r");
  });

  it("knows its own id once Trystero has made it", async () => {
    const t = open();
    await t.ready;
    expect(t.selfId).toBe("me");
  });

  // A second subscriber must not unhook the provider's handshake, or a session looks
  // connected while never syncing.
  it("fans a peer join out to every subscriber", () => {
    const t = open();
    const calls: string[] = [];
    t.onPeerJoin((id) => calls.push(`first:${id}`));
    t.onPeerJoin((id) => calls.push(`second:${id}`));
    peerJoin?.({ peerId: "alice" });
    expect(calls).toEqual(["first:alice", "second:alice"]);
  });

  it("fans a peer leave out to every subscriber", () => {
    const t = open();
    const calls: string[] = [];
    t.onPeerLeave((id) => calls.push(`first:${id}`));
    t.onPeerLeave((id) => calls.push(`second:${id}`));
    peerLeave?.({ peerId: "bob" });
    expect(calls).toEqual(["first:bob", "second:bob"]);
  });

  it("targets one peer, or broadcasts when given none", () => {
    const t = open();
    t.send("sync", new Uint8Array([1]), "alice");
    t.send("sync", new Uint8Array([2]), null);
    const sync = actions.get("ysync")!;
    expect(sync.send.mock.calls[0][1]).toEqual({ target: "alice" });
    expect(sync.send.mock.calls[1][1]).toBeUndefined();
  });

  it("keeps the two channels apart", () => {
    const t = open();
    const got: [string, number[]][] = [];
    t.onMessage((channel, payload) => got.push([channel, [...payload]]));

    actions.get("ysync")!.fire(new Uint8Array([7]).buffer, { peerId: "alice" });
    actions.get("yaware")!.fire(new Uint8Array([8]).buffer, { peerId: "bob" });

    expect(got).toEqual([["sync", [7]], ["awareness", [8]]]);
  });

  it("normalises an ArrayBuffer from the wire into a view Yjs can read", () => {
    const t = open();
    let seen: Uint8Array | null = null;
    t.onMessage((_c, payload) => void (seen = payload));
    actions.get("ysync")!.fire(new Uint8Array([1, 2, 3]).buffer, { peerId: "alice" });
    expect(seen).toBeInstanceOf(Uint8Array);
    expect([...(seen as unknown as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it("does not reject when a send fails, because a peer leaving mid-send is normal", async () => {
    const t = open();
    actions.get("ysync")!.send.mockRejectedValueOnce(new Error("peer went away"));
    expect(() => t.send("sync", new Uint8Array([1]), "gone")).not.toThrow();
    await Promise.resolve();
  });

  it("reports peers and closes the room", async () => {
    const t = open();
    expect(t.peers()).toEqual(["alice", "bob"]);
    await t.close();
    expect(room.leave).toHaveBeenCalled();
  });

  it("leaves the room only once", async () => {
    const t = open();
    await t.close();
    await t.close();
    expect(room.leave).toHaveBeenCalledTimes(1);
  });
});
