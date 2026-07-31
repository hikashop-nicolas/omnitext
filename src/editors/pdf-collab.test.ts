import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  isEmpty,
  paraKey,
  readShared,
  seedShared,
  sharedTypes,
  writeShared,
  type SharedEdits,
} from "./pdf-collab";

// Two documents and no editor, which is the only way to ask the question that matters:
// when two people edit the same PDF at once, what does each of them end up holding?

function converge(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const LOCAL = { who: "local" };

const empty = (): SharedEdits => ({ edits: [], boxes: [], images: [], whiteouts: [] });

const withEdits = (...edits: SharedEdits["edits"]): SharedEdits => ({ ...empty(), edits });

const box = (id: string, html: string): SharedEdits["boxes"][number] => ({
  id,
  page: 0,
  xPdf: 10,
  yPdf: 20,
  wPdf: 100,
  size: 12,
  align: "left",
  family: "sans",
  colorHex: "000000",
  html,
});

const image = (id: string, sha: string): SharedEdits["images"][number] => ({
  id,
  page: 0,
  mime: "image/png",
  sha,
  leftPx: 5,
  topPx: 6,
  widthPx: 100,
});

describe("the shared PDF shape", () => {
  it("starts empty, because a session shares the edits and not the file", () => {
    const doc = new Y.Doc();
    expect(isEmpty(doc)).toBe(true);
    seedShared(doc, withEdits({ page: 0, index: 1, html: "Changed." }), LOCAL);
    expect(isEmpty(doc)).toBe(false);
    expect(readShared(doc).edits).toEqual([{ page: 0, index: 1, html: "Changed.", align: undefined }]);
  });

  it("seeds once, so a joiner does not double the edits", () => {
    const doc = new Y.Doc();
    seedShared(doc, withEdits({ page: 0, index: 0, html: "First." }), LOCAL);
    seedShared(doc, withEdits({ page: 9, index: 9, html: "Something else." }), LOCAL);
    expect(readShared(doc).edits.map((e) => e.html)).toEqual(["First."]);
  });

  it("says nothing when nothing changed", () => {
    const doc = new Y.Doc();
    const state = withEdits({ page: 0, index: 0, html: "Same." });
    seedShared(doc, state, LOCAL);
    let updates = 0;
    doc.on("update", () => updates++);
    writeShared(doc, state, LOCAL);
    expect(updates, "an unchanged state produces no traffic").toBe(0);
  });

  // Keying by position is what lets two peers name the same paragraph without being told.
  it("keeps both edits when two peers change different paragraphs", () => {
    const a = new Y.Doc();
    seedShared(a, withEdits(
      { page: 0, index: 0, html: "First." },
      { page: 0, index: 1, html: "Second." },
    ), LOCAL);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    writeShared(a, withEdits(
      { page: 0, index: 0, html: "First, by Ada." },
      { page: 0, index: 1, html: "Second." },
    ), LOCAL);
    writeShared(b, withEdits(
      { page: 0, index: 0, html: "First." },
      { page: 0, index: 1, html: "Second, by Bo." },
    ), LOCAL);
    converge(a, b);

    const html = (d: Y.Doc) => readShared(d).edits.sort((x, y) => x.index - y.index).map((e) => e.html);
    expect(html(a)).toEqual(["First, by Ada.", "Second, by Bo."]);
    expect(html(b)).toEqual(["First, by Ada.", "Second, by Bo."]);
  });

  // A paragraph of a PDF is prose, and two people at opposite ends of one is ordinary.
  it("keeps both edits when two peers type in the same paragraph", () => {
    const a = new Y.Doc();
    seedShared(a, withEdits({ page: 0, index: 0, html: "The beginning and the end." }), LOCAL);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    writeShared(a, withEdits({ page: 0, index: 0, html: "The very beginning and the end." }), LOCAL);
    writeShared(b, withEdits({ page: 0, index: 0, html: "The beginning and the very end." }), LOCAL);
    converge(a, b);

    const merged = readShared(a).edits[0].html;
    expect(merged, "Ada's word survives").toContain("very beginning");
    expect(merged, "and so does Bo's").toContain("very end");
    expect(readShared(b).edits[0].html, "and both hold the same thing").toBe(merged);
  });

  it("forgets a paragraph whose edit was undone", () => {
    const doc = new Y.Doc();
    seedShared(doc, withEdits(
      { page: 0, index: 0, html: "Edited." },
      { page: 0, index: 1, html: "Also edited." },
    ), LOCAL);
    writeShared(doc, withEdits({ page: 0, index: 1, html: "Also edited." }), LOCAL);

    expect(readShared(doc).edits.map((e) => e.index)).toEqual([1]);
    const [paras] = sharedTypes(doc);
    expect(paras.has(paraKey(0, 0)), "not left behind to come back later").toBe(false);
  });

  describe("added objects", () => {
    // The reason they carry ids: two people each adding one must end up with two.
    it("keeps both when two peers each add a box", () => {
      const a = new Y.Doc();
      const b = new Y.Doc();
      seedShared(a, empty(), LOCAL);
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

      writeShared(a, { ...empty(), boxes: [box("o1-ada", "Ada's note")] }, LOCAL);
      writeShared(b, { ...empty(), boxes: [box("o1-bo", "Bo's note")] }, LOCAL);
      converge(a, b);

      const ids = (d: Y.Doc) => readShared(d).boxes.map((x) => x.id).sort();
      expect(ids(a), "two boxes, not one").toEqual(["o1-ada", "o1-bo"]);
      expect(ids(b)).toEqual(["o1-ada", "o1-bo"]);
    });

    it("carries a whiteout's rectangle", () => {
      const doc = new Y.Doc();
      writeShared(doc, {
        ...empty(),
        whiteouts: [{ id: "w1", page: 2, leftPx: 1, topPx: 2, widthPx: 3, heightPx: 4 }],
      }, LOCAL);
      expect(readShared(doc).whiteouts).toEqual([
        { id: "w1", page: 2, leftPx: 1, topPx: 2, widthPx: 3, heightPx: 4 },
      ]);
    });

    it("removes an object that was deleted", () => {
      const doc = new Y.Doc();
      writeShared(doc, { ...empty(), boxes: [box("o1", "here")] }, LOCAL);
      writeShared(doc, empty(), LOCAL);
      expect(readShared(doc).boxes).toEqual([]);
      const [, objects] = sharedTypes(doc);
      expect(objects.has("o1")).toBe(false);
    });

    it("merges two peers typing in the same added box", () => {
      const a = new Y.Doc();
      writeShared(a, { ...empty(), boxes: [box("o1", "start and finish")] }, LOCAL);
      const b = new Y.Doc();
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

      writeShared(a, { ...empty(), boxes: [box("o1", "the start and finish")] }, LOCAL);
      writeShared(b, { ...empty(), boxes: [box("o1", "start and the finish")] }, LOCAL);
      converge(a, b);

      const merged = readShared(a).boxes[0].html;
      expect(merged).toContain("the start");
      expect(merged).toContain("the finish");
      expect(readShared(b).boxes[0].html).toBe(merged);
    });
  });

  describe("images", () => {
    // The whole point of the blob channel: what crosses here is a hash, so a picture
    // pasted and deleted does not weigh on the session for the rest of its life.
    it("carries a hash, never the bytes", () => {
      const doc = new Y.Doc();
      writeShared(doc, { ...empty(), images: [image("i1", "9f86d081884c7d65")] }, LOCAL);

      expect(readShared(doc).images).toEqual([
        { id: "i1", page: 0, mime: "image/png", sha: "9f86d081884c7d65", leftPx: 5, topPx: 6, widthPx: 100 },
      ]);
      const encoded = new TextDecoder("utf-8", { fatal: false }).decode(Y.encodeStateAsUpdate(doc));
      expect(encoded, "the hash travels").toContain("9f86d081884c7d65");
      expect(encoded, "and there is nowhere for bytes to hide").not.toContain("bytes");
    });

    it("moves an image without re-sending its hash", () => {
      const doc = new Y.Doc();
      writeShared(doc, { ...empty(), images: [image("i1", "abc123")] }, LOCAL);

      let update: Uint8Array | null = null;
      doc.on("update", (u: Uint8Array) => void (update = u));
      writeShared(doc, { ...empty(), images: [{ ...image("i1", "abc123"), leftPx: 500 }] }, LOCAL);

      expect(update).not.toBeNull();
      const moved = new TextDecoder("utf-8", { fatal: false }).decode(update!);
      expect(moved, "only the position changed, so only the position is sent").not.toContain("abc123");
      expect(readShared(doc).images[0].leftPx).toBe(500);
    });
  });
});
