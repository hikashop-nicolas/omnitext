import type * as Y from "yjs";

// The shared shape for collaborating on a workbook.
//
// What travels is what people typed, never what was computed. The formula engine is
// deterministic, so every peer recalculates the same results from the same inputs; sending
// values instead would multiply the traffic by the size of the sheet and then have to
// decide whose recalculation wins.
//
// One exception is worth stating rather than hiding: the volatile functions (NOW, TODAY,
// RAND) already differ between peers today and will keep differing, because each peer
// computes its own.
//
// Cells are keyed by "Sheet!r,c", so two people typing in different cells never touch the
// same entry, which is the common case and the one that has to merge. Two people in the
// same cell is last-writer-wins: a real conflict with no good automatic answer, and rare.

export const CELLS = "sheet.cells";

export interface CellInput {
  sheet: string;
  r: number;
  c: number;
  input: string;
}

const cellMap = (doc: Y.Doc): Y.Map<string> => doc.getMap<string>(CELLS);

/** Sheet names may contain anything, so the separator goes between fields that cannot. */
export const addressOf = (sheet: string, r: number, c: number): string => `${r},${c}!${sheet}`;

export function parseAddress(key: string): { sheet: string; r: number; c: number } | null {
  const bang = key.indexOf("!");
  if (bang < 0) return null;
  const [r, c] = key.slice(0, bang).split(",").map(Number);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return { sheet: key.slice(bang + 1), r, c };
}

/** Every cell in the shared workbook. */
export function readCells(doc: Y.Doc): CellInput[] {
  const out: CellInput[] = [];
  for (const [key, input] of cellMap(doc).entries()) {
    const at = parseAddress(key);
    if (at) out.push({ ...at, input });
  }
  return out;
}

/**
 * Put changed cells into the shared workbook, writing only what actually differs.
 *
 * An empty input means the cell was cleared, and the entry is removed rather than stored
 * as an empty string, so a long editing session does not accumulate blanks.
 */
export function writeCells(doc: Y.Doc, changes: readonly CellInput[], origin: unknown): void {
  const map = cellMap(doc);
  const real = changes.filter((ch) => {
    const key = addressOf(ch.sheet, ch.r, ch.c);
    return ch.input === "" ? map.has(key) : map.get(key) !== ch.input;
  });
  if (!real.length) return;

  doc.transact(() => {
    for (const ch of real) {
      const key = addressOf(ch.sheet, ch.r, ch.c);
      if (ch.input === "") map.delete(key);
      else map.set(key, ch.input);
    }
  }, origin);
}

/** Seed an empty shared workbook. Exactly one peer may do this. */
export function seedCells(doc: Y.Doc, cells: readonly CellInput[], origin: unknown): void {
  if (cellMap(doc).size > 0) return;
  writeCells(doc, cells, origin);
}

export function isEmpty(doc: Y.Doc): boolean {
  return cellMap(doc).size === 0;
}

/** The cells named by a change event, so only what moved is applied to the grid. */
export function changedCells(doc: Y.Doc, keys: Iterable<string>): CellInput[] {
  const map = cellMap(doc);
  const out: CellInput[] = [];
  for (const key of keys) {
    const at = parseAddress(key);
    if (!at) continue;
    // A deleted key means the cell was cleared; an empty input is how that is applied.
    out.push({ ...at, input: map.get(key) ?? "" });
  }
  return out;
}

/** The shared type a session watches, and that an UndoManager should track. */
export function sharedType(doc: Y.Doc): Y.Map<string> {
  return cellMap(doc);
}
