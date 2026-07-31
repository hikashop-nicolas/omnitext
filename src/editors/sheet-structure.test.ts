import { describe, expect, it, vi } from "vitest";
import {
  OpOrderer,
  OpSequencer,
  shiftAddress,
  shiftCells,
  type OrderedOp,
  type StructuralOp,
} from "./sheet-structure";
import type { CellInput } from "./sheet-collab";

// Structural operations, which are the ones content-level merging cannot handle.
//
// The tests that matter are about what a delete does (removes, never shifts into) and
// about ordering: every peer has to end up with the same addresses, and a peer that
// receives an insert after the edit that followed it must not apply them that way round.

const cell = (r: number, c: number, input: string, sheet = "S"): CellInput => ({ sheet, r, c, input });
const op = (o: Partial<StructuralOp> = {}): StructuralOp => ({
  kind: "insert",
  axis: "row",
  sheet: "S",
  at: 2,
  count: 1,
  ...o,
});

describe("shifting an address", () => {
  it("leaves a cell above an inserted row alone, and moves one below it down", () => {
    expect(shiftAddress({ sheet: "S", r: 1, c: 1 }, op())).toEqual({ sheet: "S", r: 1, c: 1 });
    expect(shiftAddress({ sheet: "S", r: 2, c: 1 }, op())).toEqual({ sheet: "S", r: 3, c: 1 });
    expect(shiftAddress({ sheet: "S", r: 9, c: 1 }, op({ count: 3 }))).toEqual({ sheet: "S", r: 12, c: 1 });
  });

  it("does the same for columns, on the column axis only", () => {
    const insertCol = op({ axis: "col", at: 2 });
    expect(shiftAddress({ sheet: "S", r: 5, c: 1 }, insertCol)).toEqual({ sheet: "S", r: 5, c: 1 });
    expect(shiftAddress({ sheet: "S", r: 5, c: 2 }, insertCol)).toEqual({ sheet: "S", r: 5, c: 3 });
  });

  // The one that would quietly duplicate a row if it were wrong.
  it("removes a cell inside a deleted range rather than shifting it", () => {
    const del = op({ kind: "delete", at: 2, count: 2 }); // rows 2 and 3
    expect(shiftAddress({ sheet: "S", r: 1, c: 1 }, del)).toEqual({ sheet: "S", r: 1, c: 1 });
    expect(shiftAddress({ sheet: "S", r: 2, c: 1 }, del)).toBeNull();
    expect(shiftAddress({ sheet: "S", r: 3, c: 1 }, del)).toBeNull();
    expect(shiftAddress({ sheet: "S", r: 4, c: 1 }, del)).toEqual({ sheet: "S", r: 2, c: 1 });
  });

  it("never touches another sheet", () => {
    expect(shiftAddress({ sheet: "Other", r: 9, c: 1 }, op())).toEqual({ sheet: "Other", r: 9, c: 1 });
  });
});

describe("shifting the whole cell set", () => {
  it("moves what moved, keeps what did not, and drops what was deleted", () => {
    const cells = [cell(1, 1, "top"), cell(2, 1, "middle"), cell(3, 1, "bottom"), cell(1, 1, "elsewhere", "Other")];

    const inserted = shiftCells(cells, op());
    expect(inserted.find((x) => x.input === "top")).toMatchObject({ r: 1 });
    expect(inserted.find((x) => x.input === "middle")).toMatchObject({ r: 3 });
    expect(inserted.find((x) => x.input === "bottom")).toMatchObject({ r: 4 });
    expect(inserted.find((x) => x.input === "elsewhere")).toMatchObject({ sheet: "Other", r: 1 });

    const deleted = shiftCells(cells, op({ kind: "delete", at: 2, count: 1 }));
    expect(deleted.map((x) => x.input).sort()).toEqual(["bottom", "elsewhere", "top"]);
    expect(deleted.find((x) => x.input === "bottom")).toMatchObject({ r: 2 });
  });

  it("is a pure function: the caller's cells are untouched", () => {
    const cells = [cell(2, 1, "a")];
    shiftCells(cells, op());
    expect(cells[0].r).toBe(2);
  });

  // Everyone has to reach the same addresses, or the shared map means different things
  // to different people. Applying the same ops in the same order must converge.
  it("gives the same result to two peers applying the same ops in order", () => {
    const start = [cell(1, 1, "a"), cell(2, 1, "b"), cell(3, 1, "c")];
    const ops = [op({ at: 2 }), op({ kind: "delete", at: 1, count: 1 }), op({ axis: "col", at: 1 })];

    const one = ops.reduce((cells, o) => shiftCells(cells, o), start);
    const two = ops.reduce((cells, o) => shiftCells(cells, o), start);
    expect(one).toEqual(two);
  });
});

describe("ordering", () => {
  it("hands out strictly increasing numbers", () => {
    const orderer = new OpOrderer();
    expect(orderer.order(op()).seq).toBe(1);
    expect(orderer.order(op()).seq).toBe(2);
    expect(orderer.order(op()).seq).toBe(3);
  });

  it("applies in order when they arrive in order", () => {
    const seen: number[] = [];
    const seq = new OpSequencer((o) => seen.push(o.seq));
    seq.receive({ ...op(), seq: 1 });
    seq.receive({ ...op(), seq: 2 });
    expect(seen).toEqual([1, 2]);
    expect(seq.pending).toBe(0);
  });

  // The reason the sequencer exists: applying an insert after the edit that came later
  // would move addresses that had already moved.
  it("holds one that arrives early, and releases it when the gap is filled", () => {
    const seen: number[] = [];
    const seq = new OpSequencer((o) => seen.push(o.seq));

    seq.receive({ ...op(), seq: 3 });
    seq.receive({ ...op(), seq: 2 });
    expect(seen, "nothing may be applied while 1 is missing").toEqual([]);
    expect(seq.pending).toBe(2);
    expect(seq.waitingFor).toBe(1);

    seq.receive({ ...op(), seq: 1 });
    expect(seen).toEqual([1, 2, 3]);
    expect(seq.pending).toBe(0);
  });

  it("ignores a duplicate rather than applying it twice", () => {
    const apply = vi.fn();
    const seq = new OpSequencer(apply);
    const first: OrderedOp = { ...op(), seq: 1 };
    seq.receive(first);
    seq.receive(first);
    seq.receive(first);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("can start from a number, for a peer that joined mid-session", () => {
    const seen: number[] = [];
    const seq = new OpSequencer((o) => seen.push(o.seq), 5);
    seq.receive({ ...op(), seq: 3 }); // before we arrived; already in the document we were given
    seq.receive({ ...op(), seq: 5 });
    expect(seen).toEqual([5]);
  });
});
