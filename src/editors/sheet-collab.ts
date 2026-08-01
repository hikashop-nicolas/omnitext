import * as Y from "yjs";
import { spliceIds } from "./order";

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

// --- sheets and pictures --------------------------------------------------------------
//
// Cells were the only thing a session carried, so adding, renaming or removing a sheet was
// invisible to everyone else and the two workbooks quietly stopped matching. Same for
// moving or replacing a picture.
//
// Both are keyed by the id sheetedit gives them rather than by name or position. A name
// would move every cell keyed to it the moment someone renamed the sheet; a position would
// move everything the moment someone reordered.

export const SHEETS = "sheet.sheets";
export const SHEET_ORDER = "sheet.order";
export const IMAGES = "sheet.images";
export const CHARTS = "sheet.charts";

export interface SheetInfo {
  id: string;
  name: string;
  visibility?: "hidden" | "veryHidden";
}

export interface ImageAnchor {
  fromCol: number;
  fromRow: number;
  fromColOff: number;
  fromRowOff: number;
  toCol: number;
  toRow: number;
  toColOff: number;
  toRowOff: number;
}

/**
 * A chart as the session carries it: its whole definition, as one value.
 *
 * Not split into fields. Two people reconfiguring the same chart at the same moment is
 * rare, and a chart half from one and half from the other is a chart neither asked for.
 * The definition is structured data of a few kilobytes, so unlike a picture it belongs in
 * the document rather than in the blobs.
 */
export interface ChartRef {
  id: string;
  sheet: string;
  model: string;
}

/** A picture as the session carries it: where it sits, and a hash for what it shows. */
export interface ImageRef {
  id: string;
  sheet: string;
  anchor: ImageAnchor;
  sha: string;
}

type Fields = Y.Map<unknown>;

const sheetMap = (doc: Y.Doc): Y.Map<Fields> => doc.getMap<Fields>(SHEETS);
const orderArray = (doc: Y.Doc): Y.Array<string> => doc.getArray<string>(SHEET_ORDER);
const imageMap = (doc: Y.Doc): Y.Map<Fields> => doc.getMap<Fields>(IMAGES);
const chartMap = (doc: Y.Doc): Y.Map<Fields> => doc.getMap<Fields>(CHARTS);

const str = (f: Fields, k: string): string => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
const num = (f: Fields, k: string): number => (typeof f.get(k) === "number" ? (f.get(k) as number) : 0);

/** The sheets, in the order the session agrees on. Ids with no entry are skipped. */
export function readSheets(doc: Y.Doc): SheetInfo[] {
  const sheets = sheetMap(doc);
  const out: SheetInfo[] = [];
  for (const id of orderArray(doc).toArray()) {
    const f = sheets.get(id);
    if (!f) continue;
    const visibility = str(f, "visibility");
    out.push({
      id,
      name: str(f, "name"),
      visibility: visibility === "hidden" || visibility === "veryHidden" ? visibility : undefined,
    });
  }
  return out;
}

/** Write the sheet list, touching only what differs. */
export function writeSheets(doc: Y.Doc, next: readonly SheetInfo[], origin: unknown): void {
  const sheets = sheetMap(doc);
  const order = orderArray(doc);
  const prev = order.toArray();
  const ids = next.map((s) => s.id);
  const orderChanged = prev.length !== ids.length || prev.some((id, i) => id !== ids[i]);
  const wanted = new Set(ids);
  const dropped = [...sheets.keys()].filter((id) => !wanted.has(id));
  const changed = next.filter((s) => {
    const f = sheets.get(s.id);
    return !f || str(f, "name") !== s.name || str(f, "visibility") !== (s.visibility ?? "");
  });
  if (!changed.length && !dropped.length && !orderChanged) return;

  doc.transact(() => {
    for (const s of changed) {
      let f = sheets.get(s.id);
      if (!f) {
        f = new Y.Map();
        sheets.set(s.id, f);
      }
      if (str(f, "name") !== s.name) f.set("name", s.name);
      if (str(f, "visibility") !== (s.visibility ?? "")) f.set("visibility", s.visibility ?? "");
    }
    for (const id of dropped) sheets.delete(id);
    if (orderChanged) spliceIds(order, prev, ids);
  }, origin);
}

/** Every picture the session knows about. */
export function readImages(doc: Y.Doc): ImageRef[] {
  const out: ImageRef[] = [];
  for (const [id, f] of imageMap(doc)) {
    out.push({
      id,
      sheet: str(f, "sheet"),
      sha: str(f, "sha"),
      anchor: {
        fromCol: num(f, "fromCol"),
        fromRow: num(f, "fromRow"),
        fromColOff: num(f, "fromColOff"),
        fromRowOff: num(f, "fromRowOff"),
        toCol: num(f, "toCol"),
        toRow: num(f, "toRow"),
        toColOff: num(f, "toColOff"),
        toRowOff: num(f, "toRowOff"),
      },
    });
  }
  return out;
}

/** Write the pictures, touching only what differs. */
export function writeImages(doc: Y.Doc, next: readonly ImageRef[], origin: unknown): void {
  const images = imageMap(doc);
  const same = (f: Fields, im: ImageRef): boolean =>
    str(f, "sheet") === im.sheet &&
    str(f, "sha") === im.sha &&
    (Object.keys(im.anchor) as (keyof ImageAnchor)[]).every((k) => num(f, k) === im.anchor[k]);
  const changed = next.filter((im) => {
    const f = images.get(im.id);
    return !f || !same(f, im);
  });
  if (!changed.length) return;

  doc.transact(() => {
    for (const im of changed) {
      let f = images.get(im.id);
      if (!f) {
        f = new Y.Map();
        images.set(im.id, f);
      }
      if (str(f, "sheet") !== im.sheet) f.set("sheet", im.sheet);
      if (str(f, "sha") !== im.sha) f.set("sha", im.sha);
      for (const k of Object.keys(im.anchor) as (keyof ImageAnchor)[]) {
        if (num(f, k) !== im.anchor[k]) f.set(k, im.anchor[k]);
      }
    }
  }, origin);
}

/** Every chart the session knows about. */
export function readCharts(doc: Y.Doc): ChartRef[] {
  const out: ChartRef[] = [];
  for (const [id, f] of chartMap(doc)) {
    out.push({ id, sheet: str(f, "sheet"), model: str(f, "model") });
  }
  return out;
}

/** Write the charts, touching only what differs. */
export function writeCharts(doc: Y.Doc, next: readonly ChartRef[], origin: unknown): void {
  const charts = chartMap(doc);
  const wanted = new Set(next.map((c) => c.id));
  const dropped = [...charts.keys()].filter((id) => !wanted.has(id));
  const changed = next.filter((c) => {
    const f = charts.get(c.id);
    return !f || str(f, "sheet") !== c.sheet || str(f, "model") !== c.model;
  });
  if (!changed.length && !dropped.length) return;

  doc.transact(() => {
    for (const c of changed) {
      let f = charts.get(c.id);
      if (!f) {
        f = new Y.Map();
        charts.set(c.id, f);
      }
      if (str(f, "sheet") !== c.sheet) f.set("sheet", c.sheet);
      if (str(f, "model") !== c.model) f.set("model", c.model);
    }
    for (const id of dropped) charts.delete(id);
  }, origin);
}

/** The types a session watches for sheet, picture and chart changes. */
export function sheetSharedTypes(
  doc: Y.Doc,
): [Y.Map<Fields>, Y.Array<string>, Y.Map<Fields>, Y.Map<Fields>] {
  return [sheetMap(doc), orderArray(doc), imageMap(doc), chartMap(doc)];
}
