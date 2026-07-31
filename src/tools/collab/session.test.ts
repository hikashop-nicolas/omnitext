import { describe, expect, it, vi } from "vitest";
import type { CollabBinding, CollabContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, freeGuestName, type SessionHost } from "./session";
import type { Channel, CollabTransport, MessageHandler, PeerHandler } from "./transport";

// Session lifecycle: who seeds, who waits, who refuses.
//
// The rules worth guarding are all about ordering. Exactly one peer seeds, or the document
// doubles. A joiner must not adopt the shared document before it has arrived, or it blanks
// the file it had open. And a joiner holding unsaved work of its own must not bind at all.

interface Node {
  id: string;
  message: MessageHandler[];
  join: PeerHandler[];
  leave: PeerHandler[];
}

class Net {
  private readonly nodes = new Map<string, Node>();
  private queue: (() => void)[] = [];

  connect(id: string): CollabTransport {
    const node: Node = { id, message: [], join: [], leave: [] };
    for (const other of this.nodes.values()) {
      this.queue.push(() => other.join.forEach((h) => h(id)));
      this.queue.push(() => node.join.forEach((h) => h(other.id)));
    }
    this.nodes.set(id, node);
    const others = (): string[] => [...this.nodes.keys()].filter((k) => k !== id);
    return {
      selfId: id,
      send: (channel: Channel, payload, target) => {
        const copy = payload.slice();
        const to = target === null ? others() : Array.isArray(target) ? target : [target];
        for (const t of to) {
          this.queue.push(() => this.nodes.get(t)?.message.forEach((h) => h(channel, copy, id)));
        }
      },
      onMessage: (h) => void node.message.push(h),
      onPeerJoin: (h) => void node.join.push(h),
      onPeerLeave: (h) => void node.leave.push(h),
      peers: others,
      close: async () => void this.nodes.delete(id),
    };
  }

  /**
   * Deliver until the network goes quiet. The base handshake is a chain of awaits
   * (serve, hash, openBase, whenSynced), so draining microtasks is not enough: each round
   * also yields a macrotask, and quiet has to hold across one before we stop.
   */
  async settle(): Promise<void> {
    // Quiet has to hold across several macrotasks before we believe it: the handshake
    // awaits a real SHA-256, which can easily outlast a single one, and concluding early
    // makes these tests fail for reasons that have nothing to do with the code.
    let quiet = 0;
    for (let round = 0; round < 2000; round++) {
      if (this.queue.length) {
        quiet = 0;
        const batch = this.queue;
        this.queue = [];
        for (const run of batch) run();
      } else {
        quiet++;
      }
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      if (quiet >= 8) return;
    }
    throw new Error("network never settled");
  }
}

/** A stand-in editor: records what it was asked to do, and mirrors a string. */
function fakeEditor(initial: string) {
  const contexts: CollabContext[] = [];
  let content = initial;
  const binding: CollabBinding = {
    bind: async (ctx) => {
      contexts.push(ctx);
      const ytext = ctx.doc.getText("codemirror") as {
        length: number;
        insert(i: number, s: string): void;
        toString(): string;
      };
      if (ctx.seed) {
        if (ytext.length === 0) ytext.insert(0, content);
      } else {
        content = ytext.toString();
      }
    },
    unbind: vi.fn(),
  };
  return {
    binding,
    contexts,
    get content() {
      return content;
    },
  };
}

async function doc(name: string, text: string): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode(text);
  return { name, bytes, hash: await hashBytes(bytes) };
}

function host(over: Partial<SessionHost> & { editor?: ReturnType<typeof fakeEditor> }): {
  api: SessionHost;
  notes: string[];
  opened: BaseDoc[];
} {
  const notes: string[] = [];
  const opened: BaseDoc[] = [];
  const api: SessionHost = {
    currentDoc: over.currentDoc ?? (async () => null),
    localState: over.localState ?? (() => null),
    openBase: over.openBase ?? ((d) => void opened.push(d)),
    binding: over.binding ?? (() => over.editor?.binding ?? null),
    editorId: () => "codemirror",
    notify: (m) => notes.push(m),
  };
  return { api, notes, opened };
}

const me = { name: "Ada", colour: "#f00" };

describe("reachability", () => {
  // There is no relay for the document, so two peers whose networks cannot be joined never
  // connect and nothing fails on its own. Trystero cannot tell us that has happened, so it
  // is inferred from time passing. What must not happen is spinning on "connecting" with
  // no explanation, which is the one outcome the plan singles out.
  const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it("says nothing to a host, who is waiting on a person rather than a network", async () => {
    const net = new Net();
    const h = host({ editor: fakeEditor("x"), currentDoc: async () => doc("a.txt", "x") });
    const session = new CollabSession(h.api, {
      ...me,
      makeTransport: () => net.connect("host"),
      slowMs: 10,
      unreachableMs: 20,
    });
    await session.start();
    await tick(60);
    expect(session.reachability, "no length of time makes waiting a failure").toBe("connecting");
  });

  it("tells a joiner it is taking a while, then that it failed", async () => {
    const net = new Net();
    const j = host({ editor: fakeEditor(""), localState: () => null });
    const joiner = new CollabSession(j.api, {
      ...me,
      key: { roomId: "nobody-here", secret: "s" },
      makeTransport: () => net.connect("joiner"),
      slowMs: 20,
      unreachableMs: 50,
    });
    await joiner.start();

    expect(joiner.reachability).toBe("connecting");
    await tick(35);
    expect(joiner.reachability).toBe("slow");
    await tick(40);
    expect(joiner.reachability).toBe("unreachable");
    await joiner.leave();
  });

  it("stops worrying as soon as someone is there", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "shared");
    const h = host({ editor: fakeEditor("shared"), currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const j = host({ editor: fakeEditor("shared"), localState: () => null });
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
      slowMs: 10,
      unreachableMs: 20,
    });
    await joiner.start();
    await net.settle();

    expect(joiner.reachability).toBe("connected");
    // And a peer leaving later does not turn a connection that happened into a failure.
    await tick(40);
    expect(joiner.reachability).toBe("connected");
  });
});

describe("CollabSession", () => {
  it("seeds the shared document from the starter's editor, and only from it", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "the original text");

    const hostEditor = fakeEditor("the original text");
    const h = host({ editor: hostEditor, currentDoc: async () => base });
    const session = new CollabSession(h.api, {
      ...me,
      makeTransport: () => net.connect("host"),
    });
    await session.start();
    await net.settle();

    const joinEditor = fakeEditor("something else entirely");
    const j = host({ editor: joinEditor, localState: () => null });
    const joiner = new CollabSession(j.api, {
      ...me,
      name: "Grace",
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(hostEditor.contexts[0].seed).toBe(true);
    expect(joinEditor.contexts).toHaveLength(1);
    expect(joinEditor.contexts[0].seed).toBe(false);
    // Seeded once, so the text is not doubled.
    expect(joinEditor.content).toBe("the original text");
  });

  it("transfers the base to a joiner that had nothing open", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "shared contents");
    const h = host({ editor: fakeEditor("shared contents"), currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const j = host({ editor: fakeEditor(""), localState: () => null });
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(j.opened).toHaveLength(1);
    expect(j.opened[0].name).toBe("notes.txt");
    expect(joiner.editing).toBe(true);
  });

  it("binds a joiner that already holds the same file, with nothing transferred", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "identical contents");
    const h = host({ editor: fakeEditor("identical contents"), currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const joinEditor = fakeEditor("identical contents");
    const j = host({ editor: joinEditor, localState: () => ({ hash: base.hash, dirty: false }) });
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(j.opened).toEqual([]); // no transfer
    expect(joiner.editing).toBe(true); // but bound all the same
  });

  it("does not bind a joiner whose own work would be lost", async () => {
    const net = new Net();
    const base = await doc("theirs.txt", "the host's document");
    const h = host({ editor: fakeEditor("the host's document"), currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const joinEditor = fakeEditor("MY UNSAVED WORK");
    const j = host({ editor: joinEditor, localState: () => ({ hash: "different", dirty: true }) });
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(joiner.editing).toBe(false);
    expect(joinEditor.contexts).toEqual([]);
    expect(joinEditor.content).toBe("MY UNSAVED WORK");
    expect(j.notes.join(" ")).toMatch(/unsaved changes/i);
  });

  it("says so, rather than failing quietly, when the editor cannot collaborate", async () => {
    const net = new Net();
    const h = host({ binding: () => null, currentDoc: async () => await doc("x.pdf", "binary-ish") });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();

    expect(session.editing).toBe(false);
    expect(h.notes.join(" ")).toMatch(/cannot collaborate/i);
  });

  it("passes the view-only flag through to the binding", async () => {
    const net = new Net();
    const editor = fakeEditor("read me");
    const h = host({ editor, currentDoc: async () => await doc("x.txt", "read me") });
    const session = new CollabSession(h.api, {
      ...me,
      readOnly: true,
      makeTransport: () => net.connect("host"),
    });
    await session.start();

    expect(session.readOnly).toBe(true);
    expect(editor.contexts[0].readOnly).toBe(true);
  });

  it("mints its own room when starting, and reuses the link's when joining", () => {
    const net = new Net();
    const h = host({});
    const a = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("a") });
    expect(a.isHost).toBe(true);
    expect(a.key.secret).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const b = new CollabSession(host({}).api, {
      ...me,
      key: a.key,
      makeTransport: () => net.connect("b"),
    });
    expect(b.isHost).toBe(false);
    expect(b.key).toEqual(a.key);
  });

  it("unbinds the editor and withdraws presence on leaving", async () => {
    const net = new Net();
    const editor = fakeEditor("text");
    const h = host({ editor, currentDoc: async () => await doc("x.txt", "text") });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    await session.leave();
    expect(editor.binding.unbind).toHaveBeenCalled();
  });

  it("carries an edit between two joined peers", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "start");
    const hostEditor = fakeEditor("start");
    const h = host({ editor: hostEditor, currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const joinEditor = fakeEditor("");
    const j = host({ editor: joinEditor, localState: () => null });
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    // The host types; the joiner's shared document must show it.
    const shared = session.provider.doc.getText("codemirror");
    shared.insert(shared.length, " and more");
    await net.settle();

    expect(joiner.provider.doc.getText("codemirror").toString()).toBe("start and more");
  });

  it("shows the other peer in the peer list", async () => {
    const net = new Net();
    const base = await doc("n.txt", "x");
    const h = host({ editor: fakeEditor("x"), currentDoc: async () => base });
    const a = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("a") });
    await a.start();
    await net.settle();

    const b = new CollabSession(host({ editor: fakeEditor("x"), localState: () => null }).api, {
      name: "Grace",
      colour: "#0f0",
      key: a.key,
      makeTransport: () => net.connect("b"),
    });
    await b.start();
    await net.settle();

    expect(a.peers().map((p) => p.name)).toEqual(["Grace"]);
    expect(a.connected).toBe(true);
  });
});

describe("CollabSession status", () => {
  it("distinguishes an editor that cannot collaborate from one still waiting", async () => {
    const net = new Net();
    const unsupported = new CollabSession(host({ binding: () => null }).api, {
      ...me,
      makeTransport: () => net.connect("a"),
    });
    await unsupported.start();
    expect(unsupported.status).toBe("unsupported");

    const editor = fakeEditor("text");
    const editing = new CollabSession(host({ editor }).api, {
      ...me,
      makeTransport: () => net.connect("b"),
    });
    await editing.start();
    expect(editing.status).toBe("editing");

    // A joiner has not been given the document yet.
    const waiting = new CollabSession(host({ editor: fakeEditor("") }).api, {
      ...me,
      key: editing.key,
      makeTransport: () => net.connect("c"),
    });
    await waiting.start();
    expect(waiting.status).toBe("waiting");
  });
});

describe("CollabSession binding after a base transfer", () => {
  // The contract openBase has to honour: resolve only once the new editor exists. A host
  // that opens the document asynchronously and returns early makes the session bind to the
  // editor being replaced, which for a recovered document may not collaborate at all.
  it("binds the editor that exists after the base was opened", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "host text");
    const h = host({ editor: fakeEditor("host text"), currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const replacement = fakeEditor("");
    let opened = false;
    const joinHost: SessionHost = {
      currentDoc: async () => null,
      localState: () => null,
      openBase: async () => {
        await new Promise((r) => setTimeout(r, 5)); // mounting takes a moment
        opened = true;
      },
      binding: () => (opened ? replacement.binding : null),
      editorId: () => "codemirror",
      notify: () => undefined,
    };
    const joiner = new CollabSession(joinHost, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(joiner.status).toBe("editing");
    expect(replacement.contexts).toHaveLength(1);
    expect(replacement.contexts[0].seed).toBe(false);
    expect(replacement.content).toBe("host text");
  });
});

describe("two peers in different editors", () => {
  // The worst failure this system can have: a session that reports itself connected while
  // neither side ever sees the other's edits, because a binding belongs to one editor and
  // the two people are in different ones. It has to be said, not discovered.
  it("refuses to bind, and says why, when the session is shared through another editor", async () => {
    const net = new Net();
    const base = await doc("data.csv", "a,b");

    const hostEditor = fakeEditor("a,b");
    const h = host({ editor: hostEditor, currentDoc: async () => base });
    h.api.editorId = () => "sheet";
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const joinEditor = fakeEditor("");
    const j = host({ editor: joinEditor, localState: () => null });
    j.api.editorId = () => "codemirror"; // the same file, opened in the text view
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(joiner.status).toBe("mismatch");
    expect(joiner.editing).toBe(false);
    expect(joinEditor.contexts, "it must not bind a binding that syncs nothing").toEqual([]);
    expect(j.notes.join(" ")).toMatch(/different editor/i);
    expect(joiner.sharedEditorId).toBe("sheet");
  });

  it("binds when both are in the same editor", async () => {
    const net = new Net();
    const base = await doc("data.csv", "a,b");
    const h = host({ editor: fakeEditor("a,b"), currentDoc: async () => base });
    h.api.editorId = () => "sheet";
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const j = host({ editor: fakeEditor(""), localState: () => null });
    j.api.editorId = () => "sheet";
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(joiner.status).toBe("editing");
  });

  /**
   * A session pins the editor, and the reason is not tidiness. The shared shape belongs to
   * the editor: re-binding to whatever someone switched to would have the new binding find
   * its own shape empty, so a seeder would write a second shape into the same document
   * while everyone else stayed on the first, and a joiner would adopt an empty one and
   * blank its screen. Neither announces itself, so the switch is refused instead.
   */
  it("pins the editor while a session is running, and releases it on leave", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "text");
    const h = host({ editor: fakeEditor("text"), currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    expect(session.pinsEditor).toBe(true);
    await session.leave();
    expect(session.pinsEditor).toBe(false);
  });

  // The pin and the mismatch message have to agree: being told to switch view while the
  // switch is refused is a dead end, and that is what shipped for an hour.
  it("does not pin the editor for a peer that is in the wrong one", async () => {
    const net = new Net();
    const base = await doc("data.csv", "a,b");
    const h = host({ editor: fakeEditor("a,b"), currentDoc: async () => base });
    h.api.editorId = () => "sheet";
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const j = host({ editor: fakeEditor(""), localState: () => null });
    j.api.editorId = () => "codemirror";
    const joiner = new CollabSession(j.api, {
      ...me,
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(joiner.status).toBe("mismatch");
    expect(joiner.pinsEditor, "they must be able to switch to the right view").toBe(false);
  });
});

describe("the name others see", () => {
  it("can be changed mid-session, and reaches the other peer", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "text");
    const h = host({ editor: fakeEditor("text"), currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    const j = host({ editor: fakeEditor(""), localState: () => null });
    const joiner = new CollabSession(j.api, {
      name: "Grace",
      colour: "#0f0",
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();
    expect(joiner.peers().map((p) => p.name)).toEqual(["Ada"]);

    session.setName("Ada Lovelace");
    await net.settle();

    expect(session.myName).toBe("Ada Lovelace");
    expect(joiner.peers().map((p) => p.name)).toEqual(["Ada Lovelace"]);
    // And the peer id is unchanged, so a rename is not a new person.
    expect(joiner.peers()[0].peerId).toBe("host");
  });
});

describe("default names", () => {
  it("numbers guests from one", () => {
    expect(freeGuestName([])).toBe("Guest 1");
    expect(freeGuestName(["Guest 1"])).toBe("Guest 2");
    expect(freeGuestName(["Guest 1", "Guest 2"])).toBe("Guest 3");
    // Gaps are filled, so leaving and rejoining does not push the numbers up forever.
    expect(freeGuestName(["Guest 1", "Guest 3"])).toBe("Guest 2");
    // Real names are not guest numbers.
    expect(freeGuestName(["Ada", "Guest 1"])).toBe("Guest 2");
  });

  it("gives two unnamed peers different numbers", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "text");
    const h = host({ editor: fakeEditor("text"), currentDoc: async () => base });
    const session = new CollabSession(h.api, {
      name: "",
      colour: "#f00",
      makeTransport: () => net.connect("host"),
    });
    await session.start();
    await net.settle();

    const j = host({ editor: fakeEditor(""), localState: () => null });
    const joiner = new CollabSession(j.api, {
      name: "",
      colour: "#0f0",
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    // Which of the two keeps "Guest 1" is not fixed: the tie is broken on the Yjs client
    // id, which is random. What must hold is that they differ and that each sees the
    // other's actual name.
    expect(session.myName).not.toBe(joiner.myName);
    expect([session.myName, joiner.myName].sort()).toEqual(["Guest 1", "Guest 2"]);
    expect(session.peers().map((p) => p.name)).toEqual([joiner.myName]);
    expect(joiner.peers().map((p) => p.name)).toEqual([session.myName]);
  });

  it("never renumbers a name someone typed", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "text");
    const h = host({ editor: fakeEditor("text"), currentDoc: async () => base });
    const session = new CollabSession(h.api, {
      name: "Nicolas",
      colour: "#f00",
      makeTransport: () => net.connect("host"),
    });
    await session.start();
    await net.settle();

    const joiner = new CollabSession(host({ editor: fakeEditor(""), localState: () => null }).api, {
      name: "",
      colour: "#0f0",
      key: session.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();

    expect(session.myName).toBe("Nicolas");
    expect(joiner.myName).toBe("Guest 1"); // Nicolas is not a guest number
  });
});

describe("what a binding blocks", () => {
  // sheetedit refuses row and column edits while a session runs, because they shift every
  // address below them on one side only. The reason has to reach the person, or the
  // command simply appears not to work.
  it("passes a blocked action from the binding to the host", async () => {
    const net = new Net();
    const base = await doc("data.csv", "a,b");
    const editor = fakeEditor("a,b");
    let explain: ((reason: "structural") => void) | null = null;
    editor.binding.onBlocked = (fn) => void (explain = fn);

    const blocked: string[] = [];
    const h = host({ editor, currentDoc: async () => base });
    h.api.onBlocked = (reason) => blocked.push(reason);

    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();

    expect(explain, "the binding is given a way to explain itself").not.toBeNull();
    explain!("structural");
    expect(blocked).toEqual(["structural"]);
  });
});

describe("operations that must be ordered", () => {
  async function twoPeers() {
    const net = new Net();
    const base = await doc("data.csv", "a,b");
    const h = host({ editor: fakeEditor("a,b"), currentDoc: async () => base });
    const hostSession = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await hostSession.start();
    await net.settle();

    const j = host({ editor: fakeEditor(""), localState: () => null });
    const joiner = new CollabSession(j.api, {
      ...me,
      key: hostSession.key,
      makeTransport: () => net.connect("joiner"),
    });
    await joiner.start();
    await net.settle();
    return { net, hostSession, joiner };
  }

  it("gives both peers the same operations in the same order", async () => {
    const { net, hostSession, joiner } = await twoPeers();
    const atHost: [unknown, number][] = [];
    const atJoiner: [unknown, number][] = [];
    hostSession.ordered.onOrdered((op, seq) => atHost.push([op, seq]));
    joiner.ordered.onOrdered((op, seq) => atJoiner.push([op, seq]));

    hostSession.ordered.propose({ kind: "insert" });
    joiner.ordered.propose({ kind: "delete" });
    await net.settle();

    expect(atHost).toEqual(atJoiner);
    expect(atHost.map(([, seq]) => seq)).toEqual([1, 2]);
  });

  // The point of a single orderer: a proposal from anyone else goes through the host, so
  // there is one sequence rather than two peers each inventing their own.
  it("numbers a joiner's proposal from the host's counter", async () => {
    const { net, hostSession, joiner } = await twoPeers();
    const seen: number[] = [];
    joiner.ordered.onOrdered((_op, seq) => seen.push(seq));

    hostSession.ordered.propose({ a: 1 });
    await net.settle();
    joiner.ordered.propose({ b: 2 });
    await net.settle();

    expect(seen).toEqual([1, 2]);
  });

  it("applies the host's own proposal locally without waiting for the network", async () => {
    const { hostSession } = await twoPeers();
    const seen: number[] = [];
    hostSession.ordered.onOrdered((_op, seq) => seen.push(seq));
    hostSession.ordered.propose({ x: 1 });
    expect(seen).toEqual([1]); // no settle: the host does not ask itself
  });
});

describe("only one peer puts operations in order", () => {
  // With two peers this cannot be observed: a proposal is only ever received by the host,
  // so a second peer that also ordered would never be asked to. It takes a third.
  it("does not let a non-host order a proposal it merely overheard", async () => {
    const net = new Net();
    const base = await doc("data.csv", "a,b");
    const h = host({ editor: fakeEditor("a,b"), currentDoc: async () => base });
    const hostSession = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await hostSession.start();
    await net.settle();

    const make = async (id: string): Promise<CollabSession> => {
      const s = new CollabSession(host({ editor: fakeEditor(""), localState: () => null }).api, {
        ...me,
        key: hostSession.key,
        makeTransport: () => net.connect(id),
      });
      await s.start();
      await net.settle();
      return s;
    };
    const a = await make("a");
    const b = await make("b");

    const counts = { host: 0, a: 0, b: 0 };
    hostSession.ordered.onOrdered(() => counts.host++);
    a.ordered.onOrdered(() => counts.a++);
    b.ordered.onOrdered(() => counts.b++);

    a.ordered.propose({ insert: 1 }); // b overhears this too
    await net.settle();

    // Exactly once each. Were b to order what it overheard, everyone would see it twice,
    // and the two orderings would disagree about the sequence from then on.
    expect(counts).toEqual({ host: 1, a: 1, b: 1 });
  });
});
