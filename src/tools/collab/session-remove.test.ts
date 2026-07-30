import { describe, expect, it } from "vitest";
import type { CollabBinding } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabProvider } from "./provider";
import { CollabSession, type SessionHost } from "./session";
import type { Channel, CollabTransport, MessageHandler, PeerHandler } from "./transport";

// Removing someone from a session.
//
// The claim being tested is narrow and worth stating exactly: re-keying moves everyone
// else to a room the removed peer has no key for. It does NOT recall what they already
// saw. So the assertions are about what reaches them AFTER the removal, and about not
// stranding a peer whose only route to the host ran through the one being removed.

interface Node {
  id: string;
  message: MessageHandler[];
  join: PeerHandler[];
  leave: PeerHandler[];
}

/** A fake network with rooms, so a re-key genuinely changes who can hear whom. */
class Mesh {
  private readonly rooms = new Map<string, Map<string, Node>>();
  private queue: (() => void)[] = [];
  private readonly unlinked = new Set<string>();
  private pumping = true;

  /**
   * Deliver continuously rather than only when a test pumps. remove() waits on a real
   * timer to see who followed the re-key, so messages have to be flowing during that wait
   * or every peer looks stranded.
   */
  constructor() {
    const tick = (): void => {
      if (!this.pumping) return;
      if (this.queue.length) {
        const batch = this.queue;
        this.queue = [];
        for (const run of batch) run();
      }
      const t = setTimeout(tick, 0);
      (t as unknown as { unref?: () => void }).unref?.(); // never hold the test process open
    };
    const t = setTimeout(tick, 0);
    (t as unknown as { unref?: () => void }).unref?.();
  }

  stop(): void {
    this.pumping = false;
  }

  private static pair(a: string, b: string): string {
    return [a, b].sort().join("|");
  }

  unlink(a: string, b: string): void {
    this.unlinked.add(Mesh.pair(a, b));
  }

  private linked(a: string, b: string): boolean {
    return !this.unlinked.has(Mesh.pair(a, b));
  }

  transport(id: string, roomId: string): CollabTransport {
    const room = this.rooms.get(roomId) ?? new Map<string, Node>();
    this.rooms.set(roomId, room);
    const node: Node = { id, message: [], join: [], leave: [] };

    for (const other of room.values()) {
      if (!this.linked(id, other.id)) continue;
      this.queue.push(() => other.join.forEach((h) => h(id)));
      this.queue.push(() => node.join.forEach((h) => h(other.id)));
    }
    room.set(id, node);

    const visible = (): string[] =>
      [...room.values()].filter((n) => n.id !== id && this.linked(id, n.id)).map((n) => n.id);

    return {
      selfId: id,
      send: (channel: Channel, payload, target) => {
        const copy = payload.slice();
        const to = target === null ? visible() : Array.isArray(target) ? target : [target];
        for (const t of to.filter((x) => this.linked(id, x))) {
          this.queue.push(() => room.get(t)?.message.forEach((h) => h(channel, copy, id)));
        }
      },
      onMessage: (h) => void node.message.push(h),
      onPeerJoin: (h) => void node.join.push(h),
      onPeerLeave: (h) => void node.leave.push(h),
      peers: visible,
      close: async () => {
        room.delete(id);
        for (const other of room.values()) {
          this.queue.push(() => other.leave.forEach((h) => h(id)));
        }
      },
    };
  }

  /** Wait for the pump to run dry and stay dry. */
  async settle(): Promise<void> {
    let quiet = 0;
    for (let round = 0; round < 3000; round++) {
      quiet = this.queue.length ? 0 : quiet + 1;
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      if (quiet >= 12) return;
    }
    throw new Error("mesh never settled");
  }
}

const SHARED = "codemirror";

/** A stand-in editor that mirrors the shared text, as a real binding does. */
function fakeEditor(initial: string) {
  let content = initial;
  const binding: CollabBinding = {
    bind: async (ctx) => {
      const ytext = ctx.doc.getText(SHARED) as {
        length: number;
        insert(i: number, s: string): void;
        toString(): string;
        observe(fn: () => void): void;
      };
      if (ctx.seed) {
        if (ytext.length === 0) ytext.insert(0, content);
      } else {
        content = ytext.toString();
      }
      ytext.observe(() => void (content = ytext.toString()));
    },
    unbind: () => undefined,
  };
  return {
    binding,
    get content() {
      return content;
    },
  };
}

async function baseDoc(name: string, text: string): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode(text);
  return { name, bytes, hash: await hashBytes(bytes) };
}

interface Participant {
  session: CollabSession;
  editor: ReturnType<typeof fakeEditor>;
  evicted: boolean;
  notes: string[];
}

async function join(
  mesh: Mesh,
  id: string,
  text: string,
  opts: { key?: { roomId: string; secret: string }; base?: BaseDoc } = {},
): Promise<Participant> {
  const editor = fakeEditor(text);
  const state = { evicted: false, notes: [] as string[] };
  const host: SessionHost = {
    currentDoc: async () => opts.base ?? null,
    localState: () => null,
    openBase: () => undefined,
    binding: () => editor.binding,
    notify: (m) => state.notes.push(m),
    onEvicted: () => void (state.evicted = true),
  };
  const session = new CollabSession(host, {
    name: id,
    colour: "#123456",
    key: opts.key,
    // Long enough for a re-key to relay a hop or two on a loaded CI runner. Too tight and
    // a peer that did follow is reported as stranded, which is a flaky test, not a bug.
    followMs: 300,
    makeTransport: (key) => mesh.transport(id, key.roomId),
  });
  await session.start();
  return {
    session,
    editor,
    notes: state.notes,
    get evicted() {
      return state.evicted;
    },
  } as Participant;
}

const sharedText = (p: Participant): string => p.session.provider.doc.getText(SHARED).toString();
const idOf = (owner: Participant, name: string): string =>
  owner.session.peers().find((p) => p.name === name)?.peerId ?? "";

describe("removing a peer", () => {
  it("moves everyone else to a new room and tells the removed peer to close", async () => {
    const mesh = new Mesh();
    const base = await baseDoc("notes.txt", "start");
    const host = await join(mesh, "host", "start", { base });
    await mesh.settle();
    const guest = await join(mesh, "guest", "", { key: host.session.key });
    const pest = await join(mesh, "pest", "", { key: host.session.key });
    void pest;
    await mesh.settle();

    const before = host.session.key.roomId;
    const result = await host.session.remove(idOf(host, "pest"));
    await mesh.settle();

    expect(host.session.key.roomId).not.toBe(before);
    expect(guest.session.key.roomId).toBe(host.session.key.roomId);
    expect(pest.evicted).toBe(true);
    expect(pest.notes.join(" ")).toMatch(/removed from the session/i);
    expect(result.stranded).toEqual([]);
  });

  it("keeps the remaining peers editing together after the move", async () => {
    const mesh = new Mesh();
    const base = await baseDoc("notes.txt", "start");
    const host = await join(mesh, "host", "start", { base });
    await mesh.settle();
    const guest = await join(mesh, "guest", "", { key: host.session.key });
    const pest = await join(mesh, "pest", "", { key: host.session.key });
    void pest;
    await mesh.settle();

    await host.session.remove(idOf(host, "pest"));
    await mesh.settle();

    const shared = host.session.provider.doc.getText(SHARED);
    shared.insert(shared.length, " and more");
    await mesh.settle();

    expect(sharedText(guest)).toBe("start and more");
    expect(guest.editor.content).toBe("start and more");
  });

  // The security claim, stated as a test: the old key leads nowhere. A removed peer that
  // ignores the eviction entirely and sits in the old room hears nothing further.
  it("leaves the old room empty, so the old key is worthless", async () => {
    const mesh = new Mesh();
    const base = await baseDoc("notes.txt", "start");
    const host = await join(mesh, "host", "start", { base });
    await mesh.settle();
    const guest = await join(mesh, "guest", "", { key: host.session.key });
    await mesh.settle();
    void guest;

    const oldRoom = host.session.key.roomId;
    await host.session.remove(idOf(host, "guest"));
    await mesh.settle();

    // Someone who kept the old link and refuses to leave.
    const squatter = new CollabProvider(mesh.transport("squatter", oldRoom));
    await mesh.settle();

    const shared = host.session.provider.doc.getText(SHARED);
    shared.insert(shared.length, " SECRET");
    await mesh.settle();

    expect(sharedText(host)).toBe("start SECRET");
    expect(squatter.doc.getText(SHARED).toString()).toBe("");
    await squatter.destroy();
  });

  // The mesh is not complete, so the new key has to travel hop by hop. Here the host
  // cannot see "far" at all: it must arrive via "relay", and must not go through "pest".
  it("reaches a peer the host cannot see, by way of one that can", async () => {
    const mesh = new Mesh();
    mesh.unlink("host", "far");
    const base = await baseDoc("notes.txt", "start");
    const host = await join(mesh, "host", "start", { base });
    await mesh.settle();
    const relay = await join(mesh, "relay", "", { key: host.session.key });
    const far = await join(mesh, "far", "", { key: host.session.key });
    const pest = await join(mesh, "pest", "", { key: host.session.key });
    void pest;
    await mesh.settle();

    expect(host.session.peers().map((p) => p.name).sort()).toEqual(["far", "pest", "relay"]);

    const result = await host.session.remove(idOf(host, "pest"));
    await mesh.settle();

    expect(far.session.key.roomId).toBe(host.session.key.roomId);
    expect(relay.session.key.roomId).toBe(host.session.key.roomId);
    expect(result.stranded).toEqual([]);

    const shared = host.session.provider.doc.getText(SHARED);
    shared.insert(shared.length, " after");
    await mesh.settle();
    expect(sharedText(far)).toBe("start after");
  });

  // And when there is no path that avoids the removed peer, say so rather than lose them.
  it("reports a peer whose only route ran through the removed one", async () => {
    const mesh = new Mesh();
    mesh.unlink("host", "far");
    mesh.unlink("relay", "far"); // "far" can only be reached through "pest"
    const base = await baseDoc("notes.txt", "start");
    const host = await join(mesh, "host", "start", { base });
    await mesh.settle();
    const relay = await join(mesh, "relay", "", { key: host.session.key });
    const far = await join(mesh, "far", "", { key: host.session.key });
    const pest = await join(mesh, "pest", "", { key: host.session.key });
    void pest;
    await mesh.settle();

    const result = await host.session.remove(idOf(host, "pest"));
    await mesh.settle();

    expect(result.stranded.map((p) => p.name)).toEqual(["far"]);
    expect(relay.session.key.roomId).toBe(host.session.key.roomId);
    expect(far.session.key.roomId).not.toBe(host.session.key.roomId);
  });
});
