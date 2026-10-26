import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { EditCall } from "craftbridge/pdf";
import { PdfLog, Sequencer, canRedo, canUndo, inForce, type Entry, type Machine, type StoredCall } from "./pdfcraft-collab";

const op = (id: string, by: number, text = id): Entry => ({ id, by, kind: "op", op: { op: "editTextBlock", page: 0, block: 0, text } });
const undo = (id: string, by: number): Entry => ({ id, by, kind: "undo" });
const redo = (id: string, by: number): Entry => ({ id, by, kind: "redo" });
const ids = (list: Entry[]) => list.map((e) => e.id);

describe("which edits are in force", () => {
  it("keeps everything when nobody undoes", () => {
    expect(ids(inForce([op("a", 1), op("b", 2), op("c", 1)]))).toEqual(["a", "b", "c"]);
  });

  it("takes back the author's latest edit, and only theirs", () => {
    const log = [op("a", 1), op("b", 2), op("c", 1), undo("u", 1)];
    expect(ids(inForce(log))).toEqual(["a", "b"]);
    expect(ids(inForce([...log, undo("u2", 1)]))).toEqual(["b"]);
    expect(ids(inForce([...log, undo("u2", 1), undo("u3", 1)]))).toEqual(["b"]); // nothing left to take back
  });

  it("puts a redone edit back in its old place", () => {
    const log = [op("a", 1), op("b", 2), op("c", 1), undo("u", 1), op("d", 2), redo("r", 1)];
    expect(ids(inForce(log))).toEqual(["a", "b", "c", "d"]);
  });

  it("ends the redo line when the author does something new", () => {
    const log = [op("a", 1), undo("u", 1), op("b", 1)];
    expect(canRedo(log, 1)).toBe(false);
    expect(ids(inForce([...log, redo("r", 1)]))).toEqual(["b"]);
  });

  it("answers what a person can undo and redo", () => {
    const log = [op("a", 1), op("b", 2)];
    expect(canUndo(log, 1)).toBe(true);
    expect(canUndo(log, 3)).toBe(false);
    expect(canRedo(log, 1)).toBe(false);
    expect(canRedo([...log, undo("u", 1)], 1)).toBe(true);
    expect(canUndo([...log, undo("u", 1)], 1)).toBe(false);
  });
});

/** A document that is a list of applied ops with an undo stack, refusing ops that contain "bad". */
function fakeMachine(): { machine: Machine; doc: string[]; calls: string[] } {
  const doc: string[] = [];
  const calls: string[] = [];
  const machine: Machine = {
    async apply(o: StoredCall) {
      const label = o.op === "editTextBlock" ? o.text : o.op;
      calls.push(`apply ${label}`);
      if (label.includes("bad")) throw new Error("stale index");
      doc.push(label);
    },
    async undo() {
      calls.push("undo");
      doc.pop();
    },
  };
  return { machine, doc, calls };
}

describe("Sequencer", () => {
  it("applies new entries and leaves the ones it already has alone", async () => {
    const { machine, doc, calls } = fakeMachine();
    const s = new Sequencer(machine);
    await s.sync([op("a", 1), op("b", 1)]);
    await s.sync([op("a", 1), op("b", 1), op("c", 1)]);
    expect(doc).toEqual(["a", "b", "c"]);
    expect(calls).toEqual(["apply a", "apply b", "apply c"]);
  });

  it("takes back the tail that differs and applies the agreed order", async () => {
    const { machine, doc, calls } = fakeMachine();
    const s = new Sequencer(machine);
    await s.sync([op("a", 1), op("mine", 1)]);
    await s.sync([op("a", 1), op("theirs", 2), op("mine", 1)]);
    expect(doc).toEqual(["a", "theirs", "mine"]);
    expect(calls).toEqual(["apply a", "apply mine", "undo", "apply theirs", "apply mine"]);
  });

  it("takes back an undone edit from the middle by rewinding past it", async () => {
    const { machine, doc } = fakeMachine();
    const s = new Sequencer(machine);
    await s.sync([op("a", 1), op("b", 2), op("c", 1)]);
    await s.sync([op("a", 1), op("b", 2)]);
    expect(doc).toEqual(["a", "b"]);
    await s.sync([op("a", 1), op("c", 1)]);
    expect(doc).toEqual(["a", "c"]);
  });

  it("skips an edit the engine refuses, on every pass, without losing count", async () => {
    const { machine, doc, calls } = fakeMachine();
    const s = new Sequencer(machine);
    await s.sync([op("a", 1), op("bad", 2), op("c", 1)]);
    expect(doc).toEqual(["a", "c"]);
    await s.sync([op("a", 1)]); // taking back c must not also pop a: the refused edit made no step
    expect(doc).toEqual(["a"]);
    expect(calls.filter((c) => c === "undo")).toHaveLength(1);
  });

  it("runs overlapping syncs one after another", async () => {
    const { machine, doc } = fakeMachine();
    const s = new Sequencer(machine);
    const want = [op("a", 1), op("b", 1), op("c", 1)];
    await Promise.all([s.sync(want.slice(0, 1)), s.sync(want.slice(0, 2)), s.sync(want)]);
    expect(doc).toEqual(["a", "b", "c"]);
  });

  it("says what changed, and nothing when nothing did", async () => {
    const seen: { undone: number; applied: number }[] = [];
    const s = new Sequencer(fakeMachine().machine, (c) => seen.push(c));
    await s.sync([op("a", 1)]);
    await s.sync([op("a", 1)]);
    await s.sync([op("a", 1), op("b", 1)]);
    await s.sync([op("a", 1), op("x", 2), op("b", 1)]);
    expect(seen).toEqual([
      { undone: 0, applied: 1 },
      { undone: 0, applied: 1 },
      { undone: 1, applied: 2 },
    ]);
  });
});

// --- two peers over real Yjs documents ---------------------------------------------------

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  let online = true;
  const queue: Array<() => void> = [];
  const link = (from: Y.Doc, to: Y.Doc) =>
    from.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      const send = () => Y.applyUpdate(to, u, "remote");
      if (online) send();
      else queue.push(send);
    });
  link(a, b);
  link(b, a);
  return {
    a,
    b,
    offline: () => (online = false),
    online: () => {
      online = true;
      while (queue.length) queue.shift()!();
    },
  };
}

function peer(doc: Y.Doc, opts: { readOnly?: boolean; blobs?: Map<string, Uint8Array> } = {}) {
  const m = fakeMachine();
  const store = opts.blobs;
  const log = new PdfLog(
    {
      doc,
      readOnly: !!opts.readOnly,
      blobs: store && {
        put: async (bytes) => {
          const sha = `sha${bytes.length}`;
          store.set(sha, bytes);
          return sha;
        },
        get: (sha) => store.get(sha),
        fetch: async (sha) => store.get(sha) ?? null,
      },
    },
    {
      run: (call: EditCall) => m.machine.apply(call as StoredCall),
      undo: () => m.machine.undo(),
    },
    () => {},
  );
  return { ...m, log };
}

const edit = (text: string): EditCall => ({ op: "editTextBlock", page: 0, block: 0, text });

describe("PdfLog between two peers", () => {
  it("applies each other's edits", async () => {
    const { a, b } = pair();
    const p = peer(a);
    const q = peer(b);
    await p.log.start();
    await q.log.start();
    await p.log.perform(edit("one"));
    await q.log.perform(edit("two"));
    await p.log.settled();
    await q.log.settled();
    expect(p.doc).toEqual(["one", "two"]);
    expect(q.doc).toEqual(p.doc);
  });

  it("converges when both edit while apart, whatever order they meet in", async () => {
    const link = pair();
    const p = peer(link.a);
    const q = peer(link.b);
    await p.log.start();
    await q.log.start();
    await p.log.perform(edit("base"));
    link.offline();
    await p.log.perform(edit("from p"));
    await q.log.perform(edit("from q"));
    await q.log.perform(edit("from q again"));
    expect(p.doc).toEqual(["base", "from p"]);
    expect(q.doc).toEqual(["base", "from q", "from q again"]);
    link.online();
    await p.log.settled();
    await q.log.settled();
    expect(q.doc).toEqual(p.doc);
    expect([...p.doc].sort()).toEqual(["base", "from p", "from q", "from q again"].sort());
    expect(p.doc.indexOf("from q")).toBeLessThan(p.doc.indexOf("from q again"));
  });

  it("lets a peer who joins late replay everything", async () => {
    const link = pair();
    const p = peer(link.a);
    await p.log.start();
    await p.log.perform(edit("one"));
    await p.log.perform(edit("two"));
    const late = peer(link.b);
    await late.log.start();
    expect(late.doc).toEqual(["one", "two"]);
  });

  it("undoes only the author's own edit", async () => {
    const { a, b } = pair();
    const p = peer(a);
    const q = peer(b);
    await p.log.start();
    await q.log.start();
    await p.log.perform(edit("p1"));
    await q.log.perform(edit("q1"));
    await p.log.perform(edit("p2"));
    await p.log.undo();
    await q.log.settled();
    expect(p.doc).toEqual(["p1", "q1"]);
    expect(q.doc).toEqual(p.doc);
    expect(p.log.canUndo()).toBe(true);
    expect(q.log.canRedo()).toBe(false);
    await p.log.redo();
    await q.log.settled();
    expect(q.doc).toEqual(["p1", "q1", "p2"]);
    await q.log.undo();
    await p.log.settled();
    expect(p.doc).toEqual(["p1", "p2"]);
  });

  it("does nothing for an undo with nothing to undo", async () => {
    const { a } = pair();
    const p = peer(a);
    await p.log.start();
    await p.log.undo();
    await p.log.redo();
    expect(p.doc).toEqual([]);
  });

  it("carries a picture as a hash and fetches it", async () => {
    const { a, b } = pair();
    const blobs = new Map<string, Uint8Array>();
    const p = peer(a, { blobs });
    const q = peer(b, { blobs });
    await p.log.start();
    await q.log.start();
    await p.log.perform({ op: "addImage", page: 0, name: "x.png", bytes: new Uint8Array([1, 2, 3]) });
    await q.log.settled();
    expect(p.doc).toEqual(["addImage"]);
    expect(q.doc).toEqual(["addImage"]);
    const stored = a.getArray<Entry>("pdfcraft.log").get(0);
    expect(JSON.stringify(stored)).not.toContain("bytes");
    expect(stored.op).toMatchObject({ op: "addImage", sha: "sha3" });
  });

  it("refuses to share a picture without a blob store", async () => {
    const { a } = pair();
    const p = peer(a);
    await p.log.start();
    await expect(p.log.perform({ op: "addImage", page: 0, name: "x.png", bytes: new Uint8Array([1]) })).rejects.toThrow(/cannot be shared/);
  });

  it("applies a view-only peer's remote edits but records nothing of its own", async () => {
    const { a, b } = pair();
    const host = peer(a);
    const viewer = peer(b, { readOnly: true });
    await host.log.start();
    await viewer.log.start();
    await host.log.perform(edit("shown"));
    await viewer.log.settled();
    expect(viewer.doc).toEqual(["shown"]);
    await expect(viewer.log.perform(edit("nope"))).rejects.toThrow(/view-only/);
    expect(host.doc).toEqual(["shown"]);
  });

  it("stops applying after stop", async () => {
    const { a, b } = pair();
    const p = peer(a);
    const q = peer(b);
    await p.log.start();
    await q.log.start();
    q.log.stop();
    await p.log.perform(edit("one"));
    await new Promise((r) => setTimeout(r, 10));
    expect(q.doc).toEqual([]);
  });
});
