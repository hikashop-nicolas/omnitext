import { beforeEach, describe, expect, it, vi } from "vitest";

// The Trystero adapter, with Trystero itself faked.
//
// The provider tests cover the protocol; these cover the seam, which is where the
// assumptions live: that a hook may have more than one subscriber, that a targeted send
// really is targeted, and that the room is opened with the secret as its password.

interface FakeAction {
  send: ReturnType<typeof vi.fn>;
  onMessage: ((data: unknown, ctx: { peerId: string }) => void) | null;
}

const actions = new Map<string, FakeAction>();
const room = {
  makeAction: vi.fn((ns: string) => {
    const action: FakeAction = { send: vi.fn(async () => undefined), onMessage: null };
    actions.set(ns, action);
    return action;
  }),
  onPeerJoin: null as ((id: string) => void) | null,
  onPeerLeave: null as ((id: string) => void) | null,
  getPeers: vi.fn(() => ({ alice: {}, bob: {} })),
  leave: vi.fn(async () => undefined),
};
const joinRoom = vi.fn(() => room);
const sockets: Record<string, { close: ReturnType<typeof vi.fn> }> = {};
const calls: string[] = [];
const pauseRelayReconnection = vi.fn(() => void calls.push("pause"));
const resumeRelayReconnection = vi.fn(() => void calls.push("resume"));

vi.mock("trystero", () => ({
  joinRoom: (...a: unknown[]) => joinRoom(...(a as [])),
  selfId: "me",
  getRelaySockets: () => sockets,
  pauseRelayReconnection: () => pauseRelayReconnection(),
  resumeRelayReconnection: () => resumeRelayReconnection(),
}));

const { trysteroTransport, APP_ID } = await import("./transport");

beforeEach(() => {
  actions.clear();
  joinRoom.mockClear();
  room.makeAction.mockClear();
  room.leave.mockClear();
  room.onPeerJoin = room.onPeerLeave = null;
  calls.length = 0;
  pauseRelayReconnection.mockClear();
  resumeRelayReconnection.mockClear();
  for (const k of Object.keys(sockets)) delete sockets[k];
});

const open = () => trysteroTransport({ roomId: "r", secret: "s3cret" });

describe("trysteroTransport", () => {
  it("opens the room with the secret as its password", () => {
    open();
    const [config, roomId] = joinRoom.mock.calls[0] as unknown as [{ appId: string; password: string }, string];
    expect(config.password).toBe("s3cret");
    expect(config.appId).toBe(APP_ID);
    expect(roomId).toBe("r");
  });

  // The regression this file exists for. Trystero's onPeerJoin is a single slot, so an
  // adapter that assigns it lets a second subscriber silently unhook the provider's
  // handshake, and a session then looks connected while never syncing.
  it("fans a peer join out to every subscriber", () => {
    const t = open();
    const calls: string[] = [];
    t.onPeerJoin((id) => calls.push(`first:${id}`));
    t.onPeerJoin((id) => calls.push(`second:${id}`));
    room.onPeerJoin?.("alice");
    expect(calls).toEqual(["first:alice", "second:alice"]);
  });

  it("fans a peer leave out to every subscriber", () => {
    const t = open();
    const calls: string[] = [];
    t.onPeerLeave((id) => calls.push(`first:${id}`));
    t.onPeerLeave((id) => calls.push(`second:${id}`));
    room.onPeerLeave?.("bob");
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

    actions.get("ysync")!.onMessage?.(new Uint8Array([7]).buffer, { peerId: "alice" });
    actions.get("yaware")!.onMessage?.(new Uint8Array([8]).buffer, { peerId: "bob" });

    expect(got).toEqual([["sync", [7]], ["awareness", [8]]]);
  });

  it("normalises an ArrayBuffer from the wire into a view Yjs can read", () => {
    const t = open();
    let seen: Uint8Array | null = null;
    t.onMessage((_c, payload) => void (seen = payload));
    actions.get("ysync")!.onMessage?.(new Uint8Array([1, 2, 3]).buffer, { peerId: "alice" });
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

  // Trystero's relay sockets outlive its rooms and reconnect forever. An F-Droid reviewer saw
  // relay traffic minutes after leaving a session, so the last room out closes them.
  describe("the relay sockets", () => {
    // The room count lives in the module, and the tests above leave rooms open.
    let open: () => import("./transport").CollabTransport;
    beforeEach(async () => {
      vi.resetModules();
      const fresh = await import("./transport");
      open = () => fresh.trysteroTransport({ roomId: "r", secret: "s3cret" });
    });
    const relays = () => {
      sockets["wss://a"] = { close: vi.fn() };
      sockets["wss://b"] = { close: vi.fn() };
    };

    it("closes them, after pausing reconnection, when the last room closes", async () => {
      relays();
      const t = open();
      await t.close();
      expect(sockets["wss://a"]!.close).toHaveBeenCalledTimes(1);
      expect(sockets["wss://b"]!.close).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(["resume", "pause"]);
    });

    it("keeps them while another room is open", async () => {
      relays();
      const first = open();
      const second = open();
      await first.close();
      expect(sockets["wss://a"]!.close).not.toHaveBeenCalled();
      await second.close();
      expect(sockets["wss://a"]!.close).toHaveBeenCalledTimes(1);
    });

    it("lets the next room reconnect them", async () => {
      relays();
      await open().close();
      calls.length = 0;
      open();
      expect(calls).toEqual(["resume"]);
    });

    it("does nothing the second time a transport is closed", async () => {
      relays();
      const t = open();
      await t.close();
      await t.close();
      expect(sockets["wss://a"]!.close).toHaveBeenCalledTimes(1);
    });
  });
});
