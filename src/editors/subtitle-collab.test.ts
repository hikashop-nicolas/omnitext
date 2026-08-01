import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CUES, ORDER, isEmpty, readCues, seedCues, sharedTypes, writeCues, type CueLike } from "./subtitle-collab";

// The subtitle shared shape, tested with two Y.Docs and no editor.
//
// What matters is not that one peer's list round-trips, which any shape manages, but what
// happens when two people change different things at once. That is the whole reason cues
// are keyed by id rather than held as an array of records.

/** A cue as subedit shapes one; the module only requires the id. */
interface TestCue extends CueLike {
  startMs: number;
  endMs: number;
  text: string;
  [extra: string]: unknown;
}

const cue = (id: string, text: string, startMs = 0): TestCue => ({
  id,
  startMs,
  endMs: startMs + 1000,
  text,
});

const ORIGIN = { local: true };

/** Two documents that exchange updates, as two peers in a session do. */
function pair(): { a: Y.Doc; b: Y.Doc; sync: () => void } {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = (): void => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { a, b, sync };
}

const texts = (doc: Y.Doc): string[] => readCues<TestCue>(doc).map((c) => c.text);

describe("the shared subtitle shape", () => {
  it("round-trips a cue list", () => {
    const doc = new Y.Doc();
    const cues = [cue("1", "First"), cue("2", "Second", 2000), cue("3", "Third", 4000)];
    writeCues(doc, cues, ORIGIN);
    expect(readCues(doc)).toEqual(cues);
  });

  it("writes nothing at all when nothing changed", () => {
    const doc = new Y.Doc();
    const cues = [cue("1", "First"), cue("2", "Second", 2000)];
    writeCues(doc, cues, ORIGIN);

    let updates = 0;
    doc.on("update", () => updates++);
    writeCues(doc, cues, ORIGIN);
    writeCues(doc, cues.map((c) => ({ ...c })), ORIGIN); // equal by value, not by identity
    expect(updates).toBe(0);
  });

  it("touches only the cue that changed", () => {
    const doc = new Y.Doc();
    writeCues(doc, [cue("1", "First"), cue("2", "Second", 2000), cue("3", "Third", 4000)], ORIGIN);

    // Deeply, and by path: a cue is a map of fields holding a Y.Text, so an edit to a line
    // lands two levels down. The guarantee is the same one it always was, observed where
    // the change now happens.
    const touched: string[] = [];
    doc.getMap(CUES).observeDeep((events) => {
      for (const e of events) touched.push(String(e.path[0] ?? ""));
    });
    writeCues(doc, [cue("1", "First"), cue("2", "Edited", 2000), cue("3", "Third", 4000)], ORIGIN);

    expect([...new Set(touched)], "one cue, not the file").toEqual(["2"]);
  });

  it("does not rewrite the order when only text changed", () => {
    const doc = new Y.Doc();
    writeCues(doc, [cue("1", "First"), cue("2", "Second", 2000)], ORIGIN);

    let orderEvents = 0;
    doc.getArray<string>(ORDER).observe(() => orderEvents++);
    writeCues(doc, [cue("1", "Changed"), cue("2", "Second", 2000)], ORIGIN);
    expect(orderEvents).toBe(0);
  });

  it("handles insert, delete and reorder", () => {
    const doc = new Y.Doc();
    writeCues(doc, [cue("1", "a"), cue("2", "b"), cue("3", "c")], ORIGIN);

    writeCues(doc, [cue("1", "a"), cue("4", "new"), cue("2", "b"), cue("3", "c")], ORIGIN);
    expect(readCues(doc).map((c) => c.id)).toEqual(["1", "4", "2", "3"]);

    writeCues(doc, [cue("1", "a"), cue("2", "b"), cue("3", "c")], ORIGIN);
    expect(readCues(doc).map((c) => c.id)).toEqual(["1", "2", "3"]);
    // The removed cue is gone from the map too, not merely unlinked from the order.
    expect(doc.getMap<Record<string, unknown>>(CUES).has("4")).toBe(false);

    writeCues(doc, [cue("3", "c"), cue("2", "b"), cue("1", "a")], ORIGIN);
    expect(readCues(doc).map((c) => c.id)).toEqual(["3", "2", "1"]);
  });

  // The reason for the shape. Both edits must survive.
  it("merges two peers editing different cues at the same time", () => {
    const { a, b, sync } = pair();
    writeCues(a, [cue("1", "one"), cue("2", "two"), cue("3", "three")], ORIGIN);
    sync();

    writeCues(a, [cue("1", "EDITED BY A"), cue("2", "two"), cue("3", "three")], ORIGIN);
    writeCues(b, [cue("1", "one"), cue("2", "two"), cue("3", "EDITED BY B")], ORIGIN);
    sync();

    expect(texts(a)).toEqual(texts(b));
    expect(texts(a)).toEqual(["EDITED BY A", "two", "EDITED BY B"]);
  });

  it("keeps both insertions when two peers add a cue at once", () => {
    const { a, b, sync } = pair();
    writeCues(a, [cue("1", "one"), cue("2", "two")], ORIGIN);
    sync();

    writeCues(a, [cue("1", "one"), cue("a1", "from A"), cue("2", "two")], ORIGIN);
    writeCues(b, [cue("1", "one"), cue("2", "two"), cue("b1", "from B")], ORIGIN);
    sync();

    expect(readCues(a).map((c) => c.id)).toEqual(readCues(b).map((c) => c.id));
    expect(texts(a)).toContain("from A");
    expect(texts(a)).toContain("from B");
  });

  it("lets one peer delete a cue while the other edits a different one", () => {
    const { a, b, sync } = pair();
    writeCues(a, [cue("1", "one"), cue("2", "two"), cue("3", "three")], ORIGIN);
    sync();

    writeCues(a, [cue("1", "one"), cue("3", "three")], ORIGIN); // A removes cue 2
    writeCues(b, [cue("1", "ONE"), cue("2", "two"), cue("3", "three")], ORIGIN); // B edits cue 1
    sync();

    expect(readCues(a)).toEqual(readCues(b));
    expect(texts(a)).toEqual(["ONE", "three"]);
  });

  it("seeds only an empty document, so a joiner cannot double it", () => {
    const doc = new Y.Doc();
    const cues = [cue("1", "from the host")];
    seedCues(doc, cues, ORIGIN);
    expect(readCues(doc)).toEqual(cues);

    seedCues(doc, [cue("9", "from a joiner")], ORIGIN);
    expect(readCues(doc)).toEqual(cues); // unchanged
  });

  it("reports emptiness, which is how a joiner knows to wait", () => {
    const doc = new Y.Doc();
    expect(isEmpty(doc)).toBe(true);
    writeCues(doc, [cue("1", "x")], ORIGIN);
    expect(isEmpty(doc)).toBe(false);
  });

  it("carries the fields subtitles actually need, not just text", () => {
    const doc = new Y.Doc();
    const rich: TestCue = {
      id: "1",
      startMs: 100,
      endMs: 2000,
      text: "Hello",
      identifier: "intro",
      settings: "line:90%",
      assKind: "Dialogue",
      assFields: { Style: "Default", MarginL: "0" },
      notesBefore: "NOTE something",
    };
    writeCues(doc, [rich], ORIGIN);
    expect(readCues(doc)[0]).toEqual(rich);
  });

  // Undo has to be scoped, or Ctrl+Z takes back a peer's typing. This is the wiring the
  // subedit handler is given.
  it("undoes only what this peer did", () => {
    const { a, b, sync } = pair();
    writeCues(a, [cue("1", "one"), cue("2", "two")], ORIGIN);
    sync();

    const undo = new Y.UndoManager(sharedTypes(a), { trackedOrigins: new Set([ORIGIN]) });

    writeCues(b, [cue("1", "one"), cue("2", "THEIRS")], ORIGIN);
    sync();
    writeCues(a, [cue("1", "MINE"), cue("2", "THEIRS")], ORIGIN);
    sync();
    expect(texts(a)).toEqual(["MINE", "THEIRS"]);

    undo.undo();
    sync();

    expect(texts(a)[0]).toBe("one"); // my edit taken back
    expect(texts(a)[1]).toBe("THEIRS"); // theirs untouched
  });
});
