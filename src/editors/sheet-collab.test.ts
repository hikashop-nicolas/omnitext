import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addressOf,
  changedCells,
  isEmpty,
  parseAddress,
  readCells,
  seedCells,
  sharedType,
  writeCells,
  type CellInput,
} from "./sheet-collab";

// The shared workbook shape, tested with two Y.Docs and no grid.
//
// The case that has to work is two people typing in different cells at the same moment.
// The case that has to be honest is two people typing in the same one.

const cell = (sheet: string, r: number, c: number, input: string): CellInput => ({ sheet, r, c, input });
const ORIGIN = { local: true };

function pair(): { a: Y.Doc; b: Y.Doc; sync: () => void } {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = (): void => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { a, b, sync };
}

const at = (doc: Y.Doc, sheet: string, r: number, c: number): string | undefined =>
  readCells(doc).find((x) => x.sheet === sheet && x.r === r && x.c === c)?.input;

describe("the shared workbook shape", () => {
  it("round-trips cells across sheets", () => {
    const doc = new Y.Doc();
    const cells = [cell("Budget", 1, 1, "item"), cell("Budget", 2, 2, "3"), cell("Notes", 1, 1, "hello")];
    writeCells(doc, cells, ORIGIN);
    expect(readCells(doc).sort((x, y) => addressOf(x.sheet, x.r, x.c).localeCompare(addressOf(y.sheet, y.r, y.c))))
      .toEqual(cells.sort((x, y) => addressOf(x.sheet, x.r, x.c).localeCompare(addressOf(y.sheet, y.r, y.c))));
  });

  it("keeps sheet names with awkward characters apart", () => {
    // A sheet may legitimately be called "A,1" or contain a bang in a title-like name.
    const doc = new Y.Doc();
    writeCells(doc, [cell("A,1", 2, 3, "x"), cell("Sheet!One", 2, 3, "y")], ORIGIN);
    expect(at(doc, "A,1", 2, 3)).toBe("x");
    expect(at(doc, "Sheet!One", 2, 3)).toBe("y");
    expect(parseAddress(addressOf("Sheet!One", 2, 3))).toEqual({ sheet: "Sheet!One", r: 2, c: 3 });
  });

  it("carries formulas as formulas, not as their results", () => {
    const doc = new Y.Doc();
    writeCells(doc, [cell("S", 2, 3, "=B2*2")], ORIGIN);
    expect(at(doc, "S", 2, 3)).toBe("=B2*2");
  });

  it("writes nothing when nothing changed", () => {
    const doc = new Y.Doc();
    const cells = [cell("S", 1, 1, "a"), cell("S", 1, 2, "b")];
    writeCells(doc, cells, ORIGIN);

    let updates = 0;
    doc.on("update", () => updates++);
    writeCells(doc, cells, ORIGIN);
    expect(updates).toBe(0);
  });

  it("removes a cleared cell rather than storing a blank", () => {
    const doc = new Y.Doc();
    writeCells(doc, [cell("S", 1, 1, "a")], ORIGIN);
    writeCells(doc, [cell("S", 1, 1, "")], ORIGIN);
    expect(readCells(doc)).toEqual([]);

    // And clearing an already-empty cell is not a change at all.
    let updates = 0;
    doc.on("update", () => updates++);
    writeCells(doc, [cell("S", 1, 1, "")], ORIGIN);
    expect(updates).toBe(0);
  });

  // The reason for keying by address.
  it("merges two peers typing in different cells at once", () => {
    const { a, b, sync } = pair();
    writeCells(a, [cell("S", 1, 1, "start")], ORIGIN);
    sync();

    writeCells(a, [cell("S", 2, 1, "FROM A")], ORIGIN);
    writeCells(b, [cell("S", 3, 1, "FROM B")], ORIGIN);
    sync();

    expect(at(a, "S", 2, 1)).toBe("FROM A");
    expect(at(a, "S", 3, 1)).toBe("FROM B");
    expect(readCells(a).length).toBe(readCells(b).length);
  });

  it("settles on one answer, the same for both, when two peers type in the same cell", () => {
    const { a, b, sync } = pair();
    writeCells(a, [cell("S", 1, 1, "from A")], ORIGIN);
    writeCells(b, [cell("S", 1, 1, "from B")], ORIGIN);
    sync();

    expect(at(a, "S", 1, 1)).toBe(at(b, "S", 1, 1));
    expect(["from A", "from B"]).toContain(at(a, "S", 1, 1));
  });

  it("lets one peer clear a cell while the other edits another", () => {
    const { a, b, sync } = pair();
    writeCells(a, [cell("S", 1, 1, "one"), cell("S", 1, 2, "two")], ORIGIN);
    sync();

    writeCells(a, [cell("S", 1, 1, "")], ORIGIN);
    writeCells(b, [cell("S", 1, 2, "TWO")], ORIGIN);
    sync();

    expect(at(a, "S", 1, 1)).toBeUndefined();
    expect(at(a, "S", 1, 2)).toBe("TWO");
    expect(readCells(a)).toEqual(readCells(b));
  });

  it("reports only the cells a change touched, so the grid applies only those", () => {
    const doc = new Y.Doc();
    writeCells(doc, [cell("S", 1, 1, "a"), cell("S", 1, 2, "b")], ORIGIN);

    const seen: string[][] = [];
    sharedType(doc).observe((e) => seen.push([...e.keysChanged]));
    writeCells(doc, [cell("S", 1, 2, "B!")], ORIGIN);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([addressOf("S", 1, 2)]);
    expect(changedCells(doc, seen[0])).toEqual([cell("S", 1, 2, "B!")]);
  });

  it("turns a deleted key into a cleared cell, which is how the grid empties it", () => {
    const doc = new Y.Doc();
    writeCells(doc, [cell("S", 4, 5, "x")], ORIGIN);
    writeCells(doc, [cell("S", 4, 5, "")], ORIGIN);
    expect(changedCells(doc, [addressOf("S", 4, 5)])).toEqual([cell("S", 4, 5, "")]);
  });

  it("seeds only an empty workbook, so a joiner cannot overwrite the host's", () => {
    const doc = new Y.Doc();
    seedCells(doc, [cell("S", 1, 1, "host")], ORIGIN);
    seedCells(doc, [cell("S", 1, 1, "joiner")], ORIGIN);
    expect(at(doc, "S", 1, 1)).toBe("host");
  });

  it("reports emptiness, which is how a joiner knows to wait", () => {
    const doc = new Y.Doc();
    expect(isEmpty(doc)).toBe(true);
    writeCells(doc, [cell("S", 1, 1, "x")], ORIGIN);
    expect(isEmpty(doc)).toBe(false);
  });

  it("undoes only what this peer typed", () => {
    const { a, b, sync } = pair();
    writeCells(a, [cell("S", 1, 1, "one")], ORIGIN);
    sync();

    const undo = new Y.UndoManager(sharedType(a), { trackedOrigins: new Set([ORIGIN]) });

    writeCells(b, [cell("S", 2, 1, "THEIRS")], ORIGIN);
    sync();
    writeCells(a, [cell("S", 1, 1, "MINE")], ORIGIN);
    sync();

    undo.undo();
    sync();

    expect(at(a, "S", 1, 1)).toBe("one"); // mine taken back
    expect(at(a, "S", 2, 1)).toBe("THEIRS"); // theirs untouched
  });
});
