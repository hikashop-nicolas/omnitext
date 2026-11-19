import { describe, expect, it } from "vitest";
import type { FontFile } from "fontshelf";
import { catalogFamily, embeddable, fontQuery } from "./pdfcraft-fonts";

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
  noSubsetting: false, weight: 400, italic: false, variable: false, postscriptName: null, fullName: null, index: 0, ...over,
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
});
