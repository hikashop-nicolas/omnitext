import { describe, expect, it, vi } from "vitest";
import type { CollabBinding, CollabContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
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

  // Switching view replaces the editor, so the binding has to follow it or collaboration
  // stops without a word.
  it("re-attaches to the editor that replaced the old one", async () => {
    const net = new Net();
    const base = await doc("notes.txt", "text");
    const first = fakeEditor("text");
    const h = host({ editor: first, currentDoc: async () => base });
    const session = new CollabSession(h.api, { ...me, makeTransport: () => net.connect("host") });
    await session.start();
    await net.settle();
    expect(first.contexts).toHaveLength(1);

    const second = fakeEditor("text");
    h.api.binding = () => second.binding;
    await session.rebind();

    expect(first.binding.unbind).toHaveBeenCalled();
    expect(second.contexts, "the new editor is bound").toHaveLength(1);
    expect(session.status).toBe("editing");
  });
});
