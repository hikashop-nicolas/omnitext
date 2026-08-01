import type * as Y from "yjs";
import { spliceIds } from "./order";

// The shared shape for collaborating on subtitles, kept apart from the DOM so it can be
// tested with two Y.Docs and no editor.
//
// Cues are held as a map from cue id to the cue, plus an array of ids giving the order.
// A plain Y.Array of cues would have been simpler to write and wrong to use: changing a
// cue means replacing an element, and replacing element 2 while someone else inserts at 1
// loses one of the two. Keying by id means two people editing different cues never touch
// the same thing, and order changes are array operations Yjs already merges.
//
// Within one cue it is last-writer-wins. Two people typing in the same cue at the same
// moment is a real conflict with no good automatic answer, and it is rare; two people
// working on different cues is the common case, and that merges.

export const CUES = "subedit.cues";
export const ORDER = "subedit.order";

/**
 * All this module needs of a cue: an id. Everything else travels untouched, so adding a
 * field to subedit's cue does not need a change here. Generic rather than an indexed type
 * because subedit's Cue is an interface, and TypeScript will not assign one of those to an
 * index signature.
 */
export interface CueLike {
  id: string;
}

type Stored = Record<string, unknown>;

const cueMap = (doc: Y.Doc): Y.Map<Stored> => doc.getMap<Stored>(CUES);
const orderArray = (doc: Y.Doc): Y.Array<string> => doc.getArray<string>(ORDER);

/** Field-by-field equality, which is all a cue needs: its values are JSON scalars and small objects. */
function same(a: Stored | undefined, b: Stored): boolean {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The shared cue list, in order. Ids in the order with no cue behind them are skipped. */
export function readCues<T extends CueLike>(doc: Y.Doc): T[] {
  const cues = cueMap(doc);
  const out: T[] = [];
  for (const id of orderArray(doc).toArray()) {
    const cue = cues.get(id);
    if (cue) out.push({ ...cue } as unknown as T);
  }
  return out;
}

/**
 * Put the local cue list into the shared document, writing only what actually differs.
 *
 * Writing everything every time would work and would be a bad idea: every keystroke would
 * produce an update naming every cue, so the traffic and the undo steps would be
 * proportional to the file rather than to the edit.
 */
export function writeCues<T extends CueLike>(doc: Y.Doc, cues: readonly T[], origin: unknown): void {
  const map = cueMap(doc);
  const order = orderArray(doc);
  const nextIds = cues.map((c) => c.id);
  const prevIds = order.toArray();

  const changed = cues.filter((c) => !same(map.get(c.id), c as unknown as Stored));
  const wanted = new Set(nextIds);
  const dropped = [...map.keys()].filter((id) => !wanted.has(id));
  const orderChanged = prevIds.length !== nextIds.length || prevIds.some((id, i) => id !== nextIds[i]);

  if (!changed.length && !dropped.length && !orderChanged) return; // nothing to say

  doc.transact(() => {
    for (const cue of changed) map.set(cue.id, { ...(cue as unknown as Stored) });
    for (const id of dropped) map.delete(id);
    if (orderChanged) spliceIds(order, prevIds, nextIds);
  }, origin);
}


/** Seed an empty shared document from the local cues. Exactly one peer may do this. */
export function seedCues<T extends CueLike>(doc: Y.Doc, cues: readonly T[], origin: unknown): void {
  if (orderArray(doc).length > 0 || cueMap(doc).size > 0) return;
  writeCues(doc, cues, origin);
}

/** True when the shared document has nothing in it yet. */
export function isEmpty(doc: Y.Doc): boolean {
  return orderArray(doc).length === 0 && cueMap(doc).size === 0;
}

/** The shared types a session watches, and that an UndoManager should track. */
export function sharedTypes(doc: Y.Doc): [Y.Map<Stored>, Y.Array<string>, Y.Map<string>] {
  return [cueMap(doc), orderArray(doc), fieldMap(doc)];
}

// Everything the file is besides its cues: the ASS style table, the verbatim script-info
// and styles tail, the field orders, the line endings, the frame rate, the track labels.
//
// One entry per field rather than one blob for the lot, for the same reason cues are keyed:
// a peer restyling Default and a peer restyling Title are not in conflict, and a blob would
// make them one.

export const FIELDS = "subedit.fields";

export interface DocField {
  key: string;
  value: string;
}

const fieldMap = (doc: Y.Doc): Y.Map<string> => doc.getMap<string>(FIELDS);

/** The shared document fields. */
export function readFields(doc: Y.Doc): DocField[] {
  return [...fieldMap(doc).entries()].map(([key, value]) => ({ key, value }));
}

/**
 * Put the local fields into the shared document, writing only what differs.
 *
 * Fields this peer no longer has are left alone rather than deleted. A style table is not
 * a set every peer sees the same way: a peer that opened an SRT reports no styles at all,
 * and deleting on absence would let it wipe the ASS styles another peer is working on.
 * Removing a style is a deliberate act and does not travel yet.
 */
export function writeFields(doc: Y.Doc, fields: readonly DocField[], origin: unknown): void {
  const map = fieldMap(doc);
  const changed = fields.filter((f) => map.get(f.key) !== f.value);
  if (!changed.length) return;
  doc.transact(() => {
    for (const f of changed) map.set(f.key, f.value);
  }, origin);
}

/** Seed the fields from this peer. Exactly one peer may do this. */
export function seedFields(doc: Y.Doc, fields: readonly DocField[], origin: unknown): void {
  if (fieldMap(doc).size > 0) return;
  writeFields(doc, fields, origin);
}

/** The field map, for watching and for undo. */
export function fieldType(doc: Y.Doc): Y.Map<string> {
  return fieldMap(doc);
}
