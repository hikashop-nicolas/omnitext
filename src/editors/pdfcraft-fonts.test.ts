import { describe, expect, it } from "vitest";
import type { FontFile } from "fontshelf";
import { catalogFamily, embeddable, extractFace, fontQuery, singleFace, usableFace } from "./pdfcraft-fonts";

/** A bare sfnt with an OS/2 table carrying `fsType`. */
function sfnt(fsType: number): Uint8Array {
  const b = new Uint8Array(12 + 16 + 96);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([..."OS/2"].map((c) => c.charCodeAt(0)), 12);
  v.setUint32(12 + 8, 28);
  v.setUint32(12 + 12, 96);
  v.setUint16(28 + 8, fsType);
  return b;
}

const file = (over: Partial<FontFile>): FontFile => ({
  bytes: sfnt(0), family: "X", source: "local", format: "ttf", embeddable: true, embedding: "installable",
  noSubsetting: false, weight: 400, italic: false, variable: false, postscriptName: null, fullName: null, index: 0, renamed: false, ...over,
});

describe("pdfcraft fonts", () => {
  it("reads a PDF font name", () => {
    expect(fontQuery("ABCDEF+Arial-BoldMT")).toEqual({ name: "Arial-BoldMT", family: "Arial", weight: 700, italic: false });
    expect(fontQuery("TimesNewRomanPS-ItalicMT")).toMatchObject({ family: "TimesNewRoman", italic: true });
    expect(fontQuery("Calibri,Bold")).toMatchObject({ name: "Calibri,Bold", family: "Calibri", weight: 700 });
    expect(fontQuery("ArialMT")).toMatchObject({ family: "Arial", weight: 400 });
    expect(fontQuery("OpenSans-SemiBoldItalic")).toMatchObject({ family: "OpenSans", weight: 600, italic: true });
  });

  it("leaves the standard fonts to the engine", () => {
    for (const n of ["Helvetica", "Times-Roman", "Courier-Bold", "Symbol", "ZapfDingbats", "ABCDEF+", ""]) expect(fontQuery(n)).toBeNull();
  });

  it("finds the catalog family behind a PostScript family", () => {
    expect(catalogFamily("OpenSans")).toBe("Open Sans");
    expect(catalogFamily("Roboto")).toBe("Roboto");
    expect(catalogFamily("Arial")).toBeNull();
  });

  it("offers the engine only faces it embeds", () => {
    expect(embeddable(file({}))).toBe(true);
    expect(embeddable(file({ bytes: sfnt(0x0008) }))).toBe(true);
    expect(embeddable(file({ bytes: sfnt(0x0002) }))).toBe(false);
    expect(embeddable(file({ bytes: sfnt(0x0004) }))).toBe(false);
    expect(embeddable(file({ bytes: sfnt(0x000a) }))).toBe(false);
    expect(embeddable(file({ bytes: sfnt(0x0200) }))).toBe(false);
    expect(embeddable(file({ variable: true }))).toBe(false);
    expect(embeddable(file({ format: "ttc" }))).toBe(false);
    expect(embeddable(file({ format: "woff2" }))).toBe(false);
  });

  it("takes a face out of a collection as a standalone font", () => {
    const face = sfnt(0x0008);
    // ttcf header, one face at 16, its tables after: the table offset moves by 16.
    const ttc = new Uint8Array(16 + face.length);
    const v = new DataView(ttc.buffer);
    v.setUint32(0, 0x74746366);
    v.setUint32(4, 0x00010000);
    v.setUint32(8, 1);
    v.setUint32(12, 16);
    ttc.set(face, 16);
    v.setUint32(16 + 12 + 8, 28 + 16);
    const out = extractFace(ttc, 0)!;
    expect(out).toEqual(face);
    expect(extractFace(ttc, 1)).toBeNull();
    expect(extractFace(face, 0)).toBeNull();
    expect(singleFace({ bytes: ttc, format: "ttc", index: 0 })).toEqual(face);
    expect(singleFace({ bytes: face, format: "woff2", index: 0 })).toBeNull();
    expect(usableFace({ variable: false }, out)).toBe(true);
    expect(usableFace({ variable: false }, sfnt(0x0004))).toBe(false);
    expect(usableFace({ variable: true }, out)).toBe(false);
  });
});
