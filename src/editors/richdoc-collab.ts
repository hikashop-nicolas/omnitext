import * as Y from "yjs";
import { spliceIds } from "./order";

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
/**
 * The document beside its body: bands, note bodies, page geometry, added styles.
 *
 * Keyed "kind:id" in one map, so a header and the page size are separate entries and two
 * people changing one each both keep their change.
 */
export const EXTRAS = "richdoc.extras";

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
const extrasMap = (doc: Y.Doc): Y.Map<string> => doc.getMap<string>(EXTRAS);

/** One entry of the document beside its body. */
export interface ExtraRef {
  kind: string;
  id: string;
  value: string;
}

const extraKey = (kind: string, id: string): string => `${kind}:${id}`;

/** Everything the session holds beside the blocks. */
export function readExtras(doc: Y.Doc): ExtraRef[] {
  const out: ExtraRef[] = [];
  for (const [key, value] of extrasMap(doc).entries()) {
    const colon = key.indexOf(":");
    if (colon < 0) continue;
    out.push({ kind: key.slice(0, colon), id: key.slice(colon + 1), value });
  }
  return out;
}

/** Write them, touching only what differs. */
export function writeExtras(doc: Y.Doc, next: readonly ExtraRef[], origin: unknown): void {
  const extras = extrasMap(doc);
  const changed = next.filter((e) => extras.get(extraKey(e.kind, e.id)) !== e.value);
  if (!changed.length) return;
  doc.transact(() => {
    for (const e of changed) extras.set(extraKey(e.kind, e.id), e.value);
  }, origin);
}

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
  return /<table|data-docx-xml/i.test(html);
}

/**
 * How an image payload is named once it has been lifted out of a block.
 *
 * A `data:` URL inside block markup is the worst of both worlds: it puts the bytes in the
 * CRDT, where they stay for the life of the session even after the image is deleted, and
 * it makes the block too big and too binary to merge, so two people editing the paragraph
 * around the image lose one of the two edits. Replacing the payload with a short reference
 * fixes both at once.
 */
export const BLOB_SCHEME = "rdoc-blob:";

/** Every `data:` URL in this markup, in order of appearance and without duplicates. */
export function dataUrlsIn(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/src="(data:[^"]+)"/g)) found.add(m[1]);
  return [...found];
}

/** Swap each `data:` URL for its reference. Anything unmapped is left exactly as it was. */
export function toBlobRefs(html: string, shaOf: (url: string) => string | undefined): string {
  return html.replace(/src="(data:[^"]+)"/g, (whole, url: string) => {
    const sha = shaOf(url);
    return sha ? `src="${BLOB_SCHEME}${sha}"` : whole;
  });
}

/**
 * Swap each reference back for its payload, and report the ones we do not hold.
 *
 * A reference with no payload is left in place rather than blanked: the image is not gone,
 * it has not arrived, and the caller fetches it and comes back. Blanking would render an
 * empty box that looks exactly like an image somebody deleted.
 */
export function fromBlobRefs(
  html: string,
  urlOf: (sha: string) => string | undefined,
): { html: string; missing: string[] } {
  const missing: string[] = [];
  const out = html.replace(new RegExp(`src="${BLOB_SCHEME}([a-f0-9]+)"`, "g"), (whole, sha: string) => {
    const url = urlOf(sha);
    if (url) return `src="${url}"`;
    missing.push(sha);
    return whole;
  });
  return { html: out, missing };
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
    if (orderChanged) spliceIds(order, prevIds, changes.order);
  }, origin);
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

/** The extras map, watched separately from the blocks. */
export function extrasType(doc: Y.Doc): Y.Map<string> {
  return extrasMap(doc);
}
