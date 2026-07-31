import * as Y from "yjs";
import { editText } from "./richdoc-collab";

// The shared shape for collaborating on a PDF, kept apart from the DOM so it can be tested
// with two Y.Docs and no editor.
//
// A PDF session is the plan's model in its purest form: the file itself never changes, and
// what people share is the list of edits laid over it. pdfedit already works that way, so
// there is nothing to invent here, only to key correctly.
//
// Two kinds of thing, keyed two different ways:
//
//   - Edits to paragraphs that were already in the file, keyed by where they are:
//     "page:index". That is a name both peers agree on without being told, because both
//     rendered the same PDF and pdfedit numbered the paragraphs the same way. It is also
//     the reason the session refuses to pair peers on different builds: a different
//     pdfedit could number them differently, and then the name would mean two things.
//
//   - Things a person added, which were never in the file and have no position to be
//     named by, keyed by an id their author generated. Without that, two people each
//     adding a box would both call it the first one and end up with one box between them.
//
// Image bytes are not here. They travel through the blob store and this holds their hash,
// so a picture pasted and deleted does not weigh on the session for the rest of its life.

export const PARAS = "pdf.paras";
export const OBJECTS = "pdf.objects";

export interface ParagraphEdit {
  page: number;
  index: number;
  html: string;
  align?: string;
}
export interface BoxState {
  id: string;
  page: number;
  xPdf: number;
  yPdf: number;
  wPdf: number;
  size: number;
  align: string;
  family: string;
  colorHex: string;
  html: string;
}
/** An inserted image as the session carries it: the bytes are a hash away, in the blobs. */
export interface ImageRef {
  id: string;
  page: number;
  mime: string;
  sha: string;
  leftPx: number;
  topPx: number;
  widthPx: number;
}
export interface WhiteoutState {
  id: string;
  page: number;
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
}

export interface SharedEdits {
  edits: ParagraphEdit[];
  boxes: BoxState[];
  images: ImageRef[];
  whiteouts: WhiteoutState[];
}

type Fields = Y.Map<unknown>;

const paraMap = (doc: Y.Doc): Y.Map<Fields> => doc.getMap<Fields>(PARAS);
const objectMap = (doc: Y.Doc): Y.Map<Fields> => doc.getMap<Fields>(OBJECTS);

/** Where a paragraph edit lives. Position, because both peers rendered the same file. */
export const paraKey = (page: number, index: number): string => `${page}:${index}`;

const num = (f: Fields, k: string): number => (typeof f.get(k) === "number" ? (f.get(k) as number) : 0);
const str = (f: Fields, k: string): string => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
const text = (f: Fields, k: string): string => {
  const v = f.get(k);
  return v instanceof Y.Text ? v.toString() : typeof v === "string" ? v : "";
};

/** Everything the session holds, in the shape pdfedit speaks. */
export function readShared(doc: Y.Doc): SharedEdits {
  const edits: ParagraphEdit[] = [];
  for (const [key, f] of paraMap(doc)) {
    const [page, index] = key.split(":").map(Number);
    if (!Number.isFinite(page) || !Number.isFinite(index)) continue;
    edits.push({ page, index, html: text(f, "html"), align: str(f, "align") || undefined });
  }

  const boxes: BoxState[] = [];
  const images: ImageRef[] = [];
  const whiteouts: WhiteoutState[] = [];
  for (const [id, f] of objectMap(doc)) {
    const kind = str(f, "kind");
    if (kind === "box") {
      boxes.push({
        id,
        page: num(f, "page"),
        xPdf: num(f, "xPdf"),
        yPdf: num(f, "yPdf"),
        wPdf: num(f, "wPdf"),
        size: num(f, "size"),
        align: str(f, "align"),
        family: str(f, "family"),
        colorHex: str(f, "colorHex"),
        html: text(f, "html"),
      });
    } else if (kind === "image") {
      images.push({
        id,
        page: num(f, "page"),
        mime: str(f, "mime"),
        sha: str(f, "sha"),
        leftPx: num(f, "leftPx"),
        topPx: num(f, "topPx"),
        widthPx: num(f, "widthPx"),
      });
    } else if (kind === "whiteout") {
      whiteouts.push({
        id,
        page: num(f, "page"),
        leftPx: num(f, "leftPx"),
        topPx: num(f, "topPx"),
        widthPx: num(f, "widthPx"),
        heightPx: num(f, "heightPx"),
      });
    }
  }
  return { edits, boxes, images, whiteouts };
}

/** Set a scalar only when it differs, so an untouched field produces no update. */
function setIfChanged(f: Fields, key: string, value: string | number): void {
  if (f.get(key) !== value) f.set(key, value);
}

/**
 * Rewrite one rich-text field as the smallest edit that explains it.
 *
 * The same reasoning as a rich document: replacing the whole string would delete the other
 * person's word and re-insert our own copy, losing their concurrent edit. Trimming the
 * shared prefix and suffix leaves an insert or a delete at the point that changed.
 */
function setRich(f: Fields, key: string, html: string): void {
  const existing = f.get(key);
  if (existing instanceof Y.Text) editText(existing, html);
  else f.set(key, new Y.Text(html));
}

/** Put a local change into the shared document, writing only what actually differs. */
export function writeShared(doc: Y.Doc, next: SharedEdits, origin: unknown): void {
  doc.transact(() => {
    const paras = paraMap(doc);
    const wantParas = new Set(next.edits.map((e) => paraKey(e.page, e.index)));
    for (const key of [...paras.keys()]) if (!wantParas.has(key)) paras.delete(key);
    for (const edit of next.edits) {
      const key = paraKey(edit.page, edit.index);
      let f = paras.get(key);
      if (!f) {
        f = new Y.Map();
        paras.set(key, f);
      }
      setRich(f, "html", edit.html);
      setIfChanged(f, "align", edit.align ?? "");
    }

    const objects = objectMap(doc);
    const want = new Set<string>([
      ...next.boxes.map((b) => b.id),
      ...next.images.map((i) => i.id),
      ...next.whiteouts.map((w) => w.id),
    ]);
    for (const id of [...objects.keys()]) if (!want.has(id)) objects.delete(id);

    const fieldsFor = (id: string, kind: string): Fields => {
      let f = objects.get(id);
      if (!f) {
        f = new Y.Map();
        objects.set(id, f);
      }
      setIfChanged(f, "kind", kind);
      return f;
    };

    for (const b of next.boxes) {
      const f = fieldsFor(b.id, "box");
      setIfChanged(f, "page", b.page);
      setIfChanged(f, "xPdf", b.xPdf);
      setIfChanged(f, "yPdf", b.yPdf);
      setIfChanged(f, "wPdf", b.wPdf);
      setIfChanged(f, "size", b.size);
      setIfChanged(f, "align", b.align);
      setIfChanged(f, "family", b.family);
      setIfChanged(f, "colorHex", b.colorHex);
      setRich(f, "html", b.html);
    }
    for (const i of next.images) {
      const f = fieldsFor(i.id, "image");
      setIfChanged(f, "page", i.page);
      setIfChanged(f, "mime", i.mime);
      setIfChanged(f, "sha", i.sha);
      setIfChanged(f, "leftPx", i.leftPx);
      setIfChanged(f, "topPx", i.topPx);
      setIfChanged(f, "widthPx", i.widthPx);
    }
    for (const w of next.whiteouts) {
      const f = fieldsFor(w.id, "whiteout");
      setIfChanged(f, "page", w.page);
      setIfChanged(f, "leftPx", w.leftPx);
      setIfChanged(f, "topPx", w.topPx);
      setIfChanged(f, "widthPx", w.widthPx);
      setIfChanged(f, "heightPx", w.heightPx);
    }
  }, origin);
}

/** Seed an empty shared document from what this peer has already edited. */
export function seedShared(doc: Y.Doc, edits: SharedEdits, origin: unknown): void {
  if (!isEmpty(doc)) return;
  writeShared(doc, edits, origin);
}

/**
 * True when nothing has been shared yet.
 *
 * An unedited PDF is legitimately empty here, because a session shares the edits and not
 * the file. So this says "no edits yet", not "no document", and a joiner must not read it
 * as a reason to refuse.
 */
export function isEmpty(doc: Y.Doc): boolean {
  return paraMap(doc).size === 0 && objectMap(doc).size === 0;
}

/** The shared types a session watches, and that an UndoManager should track. */
export function sharedTypes(doc: Y.Doc): [Y.Map<Fields>, Y.Map<Fields>] {
  return [paraMap(doc), objectMap(doc)];
}
