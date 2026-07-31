import * as Y from "yjs";

// The shared shape for collaborating on a rich document, kept apart from the DOM so it can
// be tested with two Y.Docs and no editor.
//
// A body is a list of blocks with stable ids (richdoc's data-rdoc-bid), so the shape is the
// same one the subtitle editor uses: a map from id to content, plus an array of ids giving
// the order. Keying by id rather than position is what lets two people edit different
// paragraphs at once; a Y.Array of blocks would lose one of two concurrent edits, because
// changing a block means replacing an element.
//
// Within a block the content is a Y.Text, not a string, and that is the part worth
// explaining. Two people typing in the same paragraph is not rare the way two people typing
// in the same subtitle cue is: a paragraph is long, and a document has few of them. Storing
// the block's inline HTML as text and sending the edit as an insert or a delete at a
// position means both people's words survive, which is the whole reason a CRDT is here.
//
// Structured blocks are the exception and are held as a plain string instead. A table, an
// image or a run carrying opaque .docx XML is a payload, not prose: merging two people's
// character edits inside one produces markup that is not valid and did not come from
// either of them. For those, last writer wins.
//
// The type has to differ, not just the write path. A Y.Text cannot express last writer
// wins: two peers who each clear it and insert their own version converge on both versions
// one after the other, which is precisely the nonsense being avoided. A Y.Map entry set to
// a string does resolve to one of the two, so that is what a structured block is.

export const BLOCKS = "richdoc.blocks";
export const ORDER = "richdoc.order";

/** One block's identity and inline markup, as richdoc reports and accepts them. */
export interface BlockState {
  id: string;
  html: string;
}

/** What richdoc reports after a local edit. */
export interface BlockChanges {
  changed: BlockState[];
  removed: string[];
  order: string[];
}

/** Prose merges, so it is a Y.Text; a structure cannot, so it is a plain string. */
type Stored = Y.Text | string;

const blockMap = (doc: Y.Doc): Y.Map<Stored> => doc.getMap<Stored>(BLOCKS);
const orderArray = (doc: Y.Doc): Y.Array<string> => doc.getArray<string>(ORDER);

const htmlOf = (value: Stored | undefined): string | undefined =>
  value === undefined ? undefined : typeof value === "string" ? value : value.toString();

/**
 * Blocks whose markup must be replaced rather than merged.
 *
 * A table's cells, an image's data URL and a `data-docx-xml` passthrough are all structures
 * where an insert at a character offset means nothing. The test is deliberately broad: the
 * cost of replacing a block that could have merged is one person's edit losing to another's,
 * and the cost of merging one that could not is markup neither of them wrote.
 */
export function isStructured(html: string): boolean {
  return /<table|<img|data-docx-xml/i.test(html);
}

/** The shared body, in order. Ids with no block behind them are skipped. */
export function readBlocks(doc: Y.Doc): BlockState[] {
  const blocks = blockMap(doc);
  const out: BlockState[] = [];
  for (const id of orderArray(doc).toArray()) {
    const html = htmlOf(blocks.get(id));
    if (html !== undefined) out.push({ id, html });
  }
  return out;
}

/** Everything the shared document holds, as richdoc would accept it. */
export function readAsChanges(doc: Y.Doc): BlockChanges {
  const blocks = readBlocks(doc);
  return { changed: blocks, removed: [], order: blocks.map((b) => b.id) };
}

/**
 * Rewrite one block's text as the smallest edit that explains it.
 *
 * Replacing the whole string would work and would be wrong: it would delete the other
 * person's word and re-insert our own copy of it, so their concurrent edit would be lost
 * and the undo step would name the whole paragraph. Trimming the shared prefix and suffix
 * leaves an insert or a delete at the point that actually changed, which is what merges.
 */
export function editText(text: Y.Text, next: string): void {
  const prev = text.toString();
  if (prev === next) return;

  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev[start] === next[start]) start++;
  // Never split a surrogate pair: half of one is not a character, and inserting at that
  // offset would produce a string neither side wrote.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;

  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) {
    endPrev++;
    endNext++;
  }

  if (endPrev > start) text.delete(start, endPrev - start);
  if (endNext > start) text.insert(start, next.slice(start, endNext));
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Put a local change into the shared document, writing only what actually differs. */
export function writeBlocks(doc: Y.Doc, changes: BlockChanges, origin: unknown): void {
  const blocks = blockMap(doc);
  const order = orderArray(doc);
  const prevIds = order.toArray();
  const orderChanged =
    prevIds.length !== changes.order.length || prevIds.some((id, i) => id !== changes.order[i]);

  const toWrite = changes.changed.filter((b) => htmlOf(blocks.get(b.id)) !== b.html);
  const toRemove = changes.removed.filter((id) => blocks.has(id));
  if (!toWrite.length && !toRemove.length && !orderChanged) return; // nothing to say

  doc.transact(() => {
    for (const block of toWrite) {
      const existing = blocks.get(block.id);
      // A block can change kind: pasting an image into a paragraph makes it a structure,
      // deleting one makes it prose again. The stored type follows the content, so the
      // merge behaviour always matches what the block now is.
      if (isStructured(block.html)) blocks.set(block.id, block.html);
      else if (existing instanceof Y.Text) editText(existing, block.html);
      else blocks.set(block.id, new Y.Text(block.html));
    }
    for (const id of toRemove) blocks.delete(id);
    if (orderChanged) spliceOrder(order, prevIds, changes.order);
  }, origin);
}

/**
 * Replace the id order with the smallest delete and insert that explains it, so inserting
 * one paragraph is one small operation rather than a rewrite of the whole body.
 */
function spliceOrder(order: Y.Array<string>, prev: string[], next: string[]): void {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  if (endPrev > start) order.delete(start, endPrev - start);
  if (endNext > start) order.insert(start, next.slice(start, endNext));
}

/** Seed an empty shared document from the local body. Exactly one peer may do this. */
export function seedBlocks(doc: Y.Doc, blocks: readonly BlockState[], origin: unknown): void {
  if (!isEmpty(doc)) return;
  writeBlocks(doc, { changed: [...blocks], removed: [], order: blocks.map((b) => b.id) }, origin);
}

/** True when the shared document has nothing in it yet. */
export function isEmpty(doc: Y.Doc): boolean {
  return orderArray(doc).length === 0 && blockMap(doc).size === 0;
}

/** The shared types a session watches, and that an UndoManager should track. */
export function sharedTypes(doc: Y.Doc): [Y.Map<Stored>, Y.Array<string>] {
  return [blockMap(doc), orderArray(doc)];
}
