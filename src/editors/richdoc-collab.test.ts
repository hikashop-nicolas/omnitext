import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  dataUrlsIn,
  fromBlobRefs,
  toBlobRefs,
  editText,
  isEmpty,
  isStructured,
  readBlocks,
  seedBlocks,
  sharedTypes,
  writeBlocks,
  type BlockChanges,
} from "./richdoc-collab";

// Two documents and no editor, which is the only way to ask the question that matters:
// when two people change the same body at once, what does each of them end up holding?

/** Sync a into b and b into a, the way a session's provider does. */
function converge(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const para = (id: string, text: string): { id: string; html: string } => ({ id, html: text });

const body = (...blocks: { id: string; html: string }[]): BlockChanges => ({
  changed: blocks,
  removed: [],
  order: blocks.map((b) => b.id),
});

const LOCAL = { who: "local" };

describe("the shared rich-document shape", () => {
  it("is empty until something is written", () => {
    const doc = new Y.Doc();
    expect(isEmpty(doc)).toBe(true);
    seedBlocks(doc, [para("b1", "Hello.")], LOCAL);
    expect(isEmpty(doc)).toBe(false);
    expect(readBlocks(doc)).toEqual([para("b1", "Hello.")]);
  });

  it("seeds once, so a second peer does not double the body", () => {
    const doc = new Y.Doc();
    seedBlocks(doc, [para("b1", "First.")], LOCAL);
    seedBlocks(doc, [para("b2", "A different document.")], LOCAL);
    expect(readBlocks(doc)).toEqual([para("b1", "First.")]);
  });

  it("says nothing when nothing changed", () => {
    const doc = new Y.Doc();
    seedBlocks(doc, [para("b1", "Hello.")], LOCAL);
    let updates = 0;
    doc.on("update", () => updates++);
    writeBlocks(doc, body(para("b1", "Hello.")), LOCAL);
    expect(updates, "an unchanged body produces no traffic").toBe(0);
  });

  // The reason blocks are keyed by id: two people in different paragraphs must both survive.
  it("keeps both edits when two peers change different blocks", () => {
    const a = new Y.Doc();
    seedBlocks(a, [para("b1", "First."), para("b2", "Second.")], LOCAL);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    writeBlocks(a, body(para("b1", "First, by Ada."), para("b2", "Second.")), LOCAL);
    writeBlocks(b, body(para("b1", "First."), para("b2", "Second, by Bo.")), LOCAL);
    converge(a, b);

    const expected = [para("b1", "First, by Ada."), para("b2", "Second, by Bo.")];
    expect(readBlocks(a)).toEqual(expected);
    expect(readBlocks(b)).toEqual(expected);
  });

  // The reason a block is a Y.Text and not a string: a paragraph is long, and two people
  // working at opposite ends of one is ordinary rather than exotic.
  it("keeps both edits when two peers type in the same paragraph", () => {
    const a = new Y.Doc();
    seedBlocks(a, [para("b1", "The beginning and the end.")], LOCAL);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    writeBlocks(a, body(para("b1", "The very beginning and the end.")), LOCAL);
    writeBlocks(b, body(para("b1", "The beginning and the very end.")), LOCAL);
    converge(a, b);

    const merged = readBlocks(a)[0].html;
    expect(merged, "Ada's word survives").toContain("very beginning");
    expect(merged, "and so does Bo's").toContain("very end");
    expect(readBlocks(b)[0].html, "and both hold the same thing").toBe(merged);
  });

  it("sends only the part of a paragraph that changed", () => {
    const doc = new Y.Doc();
    const long = "A sentence that is quite long and mostly unchanged by this edit.";
    seedBlocks(doc, [para("b1", long)], LOCAL);

    let update: Uint8Array | null = null;
    doc.on("update", (u: Uint8Array) => void (update = u));
    writeBlocks(doc, body(para("b1", long.replace("quite", "very"))), LOCAL);

    expect(update).not.toBeNull();
    // The whole paragraph re-sent would be well over its own length in bytes; a four-letter
    // word is not. The exact size is Yjs's business, the order of magnitude is the point.
    expect(update!.byteLength).toBeLessThan(long.length);
  });

  describe("structured blocks", () => {
    it("recognises the ones that cannot merge", () => {
      expect(isStructured("<table><tr><td>x</td></tr></table>")).toBe(true);
      expect(isStructured('<p data-docx-xml="..."></p>')).toBe(true);
      expect(isStructured("<p>Ordinary prose.</p>")).toBe(false);
    });

    // An image used to make its whole block unmergeable, which cost two people editing
    // the text around a picture one of their edits. Once the payload is a short reference
    // the block is ordinary prose again.
    it("no longer treats a paragraph as unmergeable just for holding an image", () => {
      expect(isStructured('<p>Words <img src="rdoc-blob:9f86d0"> more words.</p>')).toBe(false);
    });

    // Last writer wins, deliberately. Merging character edits inside a table produces
    // markup neither person wrote, which is worse than losing one of the two edits.
    it("replaces a table wholesale rather than merging into it", () => {
      const a = new Y.Doc();
      seedBlocks(a, [para("b1", "<table><tr><td>one</td></tr></table>")], LOCAL);
      const b = new Y.Doc();
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

      writeBlocks(a, body(para("b1", "<table><tr><td>Ada</td></tr></table>")), LOCAL);
      writeBlocks(b, body(para("b1", "<table><tr><td>Bo</td></tr></table>")), LOCAL);
      converge(a, b);

      const result = readBlocks(a)[0].html;
      expect(readBlocks(b)[0].html).toBe(result);
      // One of the two, whole and valid, rather than a splice of both.
      expect(["<table><tr><td>Ada</td></tr></table>", "<table><tr><td>Bo</td></tr></table>"]).toContain(
        result,
      );
    });

    // A block changes kind when a paragraph becomes a table or stops being one. The stored
    // type has to follow, or a paragraph that became a table would keep merging character
    // edits inside markup where that means nothing.
    it("follows a block from prose to structure and back", () => {
      const doc = new Y.Doc();
      seedBlocks(doc, [para("b1", "Just words.")], LOCAL);
      const [blocks] = sharedTypes(doc);
      expect(blocks.get("b1"), "prose starts mergeable").toBeInstanceOf(Y.Text);

      writeBlocks(doc, body(para("b1", "<table><tr><td>now a table</td></tr></table>")), LOCAL);
      expect(typeof blocks.get("b1"), "a structure is not").toBe("string");
      expect(readBlocks(doc)[0].html).toContain("<table");

      writeBlocks(doc, body(para("b1", "Words again.")), LOCAL);
      expect(blocks.get("b1"), "and back to mergeable when the table goes").toBeInstanceOf(Y.Text);
      expect(readBlocks(doc)[0].html).toBe("Words again.");
    });
  });

  describe("order", () => {
    it("inserts a block without rewriting the ones around it", () => {
      const doc = new Y.Doc();
      seedBlocks(doc, [para("b1", "First."), para("b2", "Third.")], LOCAL);
      const [, order] = sharedTypes(doc);

      writeBlocks(
        doc,
        { changed: [para("b9", "Second.")], removed: [], order: ["b1", "b9", "b2"] },
        LOCAL,
      );

      expect(order.toArray()).toEqual(["b1", "b9", "b2"]);
      expect(readBlocks(doc).map((b) => b.html)).toEqual(["First.", "Second.", "Third."]);
    });

    it("removes a block and forgets its content", () => {
      const doc = new Y.Doc();
      seedBlocks(doc, [para("b1", "First."), para("b2", "Second.")], LOCAL);
      const [blocks] = sharedTypes(doc);

      writeBlocks(doc, { changed: [], removed: ["b2"], order: ["b1"] }, LOCAL);

      expect(readBlocks(doc)).toEqual([para("b1", "First.")]);
      expect(blocks.has("b2"), "not left behind to be resurrected by a reorder").toBe(false);
    });

    it("moves a block without touching its content", () => {
      const doc = new Y.Doc();
      seedBlocks(doc, [para("b1", "First."), para("b2", "Second.")], LOCAL);

      writeBlocks(doc, { changed: [], removed: [], order: ["b2", "b1"] }, LOCAL);

      expect(readBlocks(doc)).toEqual([para("b2", "Second."), para("b1", "First.")]);
    });

    it("skips an id in the order with no block behind it", () => {
      const doc = new Y.Doc();
      seedBlocks(doc, [para("b1", "First.")], LOCAL);
      const [, order] = sharedTypes(doc);
      order.insert(1, ["ghost"]);
      expect(readBlocks(doc)).toEqual([para("b1", "First.")]);
    });
  });

  describe("editText", () => {
    it("leaves an unchanged string alone", () => {
      const doc = new Y.Doc();
      const text = doc.getText("t");
      text.insert(0, "unchanged");
      let updates = 0;
      doc.on("update", () => updates++);
      editText(text, "unchanged");
      expect(updates).toBe(0);
    });

    const roundTrip = (from: string, to: string): string => {
      const doc = new Y.Doc();
      const text = doc.getText("t");
      text.insert(0, from);
      editText(text, to);
      return text.toString();
    };

    it("produces the new string whatever the shape of the edit", () => {
      expect(roundTrip("abc", "aXbc")).toBe("aXbc"); // insert in the middle
      expect(roundTrip("abc", "ac")).toBe("ac"); // delete in the middle
      expect(roundTrip("abc", "")).toBe(""); // delete everything
      expect(roundTrip("", "abc")).toBe("abc"); // insert into nothing
      expect(roundTrip("abc", "xyz")).toBe("xyz"); // nothing in common
      expect(roundTrip("aaa", "aaaa")).toBe("aaaa"); // ambiguous, repeated characters
    });

    // Half a surrogate pair is not a character. Trimming a shared prefix that ends inside
    // one would leave the block holding a string neither peer wrote.
    it("does not split a surrogate pair", () => {
      expect(roundTrip("a😀b", "a😀c")).toBe("a😀c");
      expect(roundTrip("😀😀", "😀")).toBe("😀");
      expect(roundTrip("x😀y", "xy")).toBe("xy");
      expect(roundTrip("héllo 😀", "héllo 😀 world")).toBe("héllo 😀 world");
    });
  });
});

describe("image payloads", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

  it("finds every payload once, however often it appears", () => {
    const html = `<p><img src="${png}"> and again <img src="${png}"></p>`;
    expect(dataUrlsIn(html)).toEqual([png]);
  });

  it("swaps a payload for its reference and back, exactly", () => {
    const html = `<p>Before <img src="${png}" width="20"> after.</p>`;
    const refs = toBlobRefs(html, () => "abc123");
    expect(refs, "the payload is gone from the markup").not.toContain("base64");
    expect(refs).toContain('src="rdoc-blob:abc123"');
    expect(refs, "and everything else is untouched").toContain('width="20"');

    const back = fromBlobRefs(refs, () => png);
    expect(back.html, "restored byte for byte").toBe(html);
    expect(back.missing).toEqual([]);
  });

  // A reference with no payload means the image has not arrived, not that it was deleted.
  // Blanking it would render an empty box that looks exactly like a deletion.
  it("leaves a reference alone when the payload has not arrived, and says which", () => {
    const html = '<p><img src="rdoc-blob:deadbeef"></p>';
    const { html: out, missing } = fromBlobRefs(html, () => undefined);
    expect(out, "left as it was rather than blanked").toBe(html);
    expect(missing).toEqual(["deadbeef"]);
  });

  it("leaves a payload alone when it has no reference yet", () => {
    const html = `<p><img src="${png}"></p>`;
    expect(toBlobRefs(html, () => undefined)).toBe(html);
  });
});
