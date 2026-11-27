/// <reference types="vite/client" />
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sniffSheetText } from "sheetedit";
import { FormatRegistry } from "../core/registries";
import type { FormatDescriptor } from "../core/types";
import { contentFormatFor } from "../core/sniff";
import { decodeBytes, looksBinary } from "../core/encoding";
import { makeTextFormats } from "./codemirror-formats";
import { makeGenericViewerFormats, makeViewerFormats } from "./binary-viewers";
import { sheetExportCandidate, sheetExportFormatFor, sheetExportKind } from "./sheet-export";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const SSML = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Sheet1"><Table><Row><Cell><Data ss:Type="Number">1</Data></Cell></Row></Table></Worksheet>
</Workbook>`;
const SSML_BARE = `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet/></Workbook>`;
const EXCEL_PAGE = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta name=ProgId content=Excel.Sheet><meta name=Generator content="Microsoft Excel 15">
<style>.xl65 {mso-number-format:"0\\.00";}</style></head>
<body><table><tr><td x:num>1</td><td class=xl65 x:num="2.5">2.50</td></tr></table></body></html>`;
const EXPORTED_PAGE = `<!DOCTYPE html><html><head><style>td{mso-number-format:"\\@";}</style></head><body><table><tr><td>007</td></tr></table></body></html>`;
const EXCEL_MHT = `MIME-Version: 1.0
X-Document-Type: Workbook
Content-Type: multipart/related; boundary="----=_NextPart_01D"

------=_NextPart_01D
Content-Location: file:///C:/book.htm
Content-Type: text/html; charset="us-ascii"

<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table><tr><td>1</td></tr></table></body></html>
------=_NextPart_01D--
`;

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>a</groupId></project>`;
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><item><title>One</title></item></channel></rss>`;
const SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`;
const ODF_STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:styles/></office:document-styles>`;
const WIKI = `<!DOCTYPE html><html lang="en"><head><title>List of countries by population</title></head>
<body><table class="wikitable sortable"><tr><th>Country</th><th>Population</th></tr><tr><td>India</td><td>1,428,627,663</td></tr></table></body></html>`;
const WORD_PAGE = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15">
<style>p.MsoNormal {mso-style-parent:""; mso-pagination:widow-orphan;}</style></head>
<body><table class=MsoTableGrid><tr><td><p class=MsoNormal>1</p></td></tr></table></body></html>`;
const PPT_PAGE = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:p="urn:schemas-microsoft-com:office:powerpoint" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta name=ProgId content=PowerPoint.Slide><meta name=Generator content="Microsoft PowerPoint 15"></head>
<body><table><tr><td>Slide 1</td></tr></table></body></html>`;
const PLAIN_MHT = `MIME-Version: 1.0
Content-Type: multipart/related; boundary="b"

--b
Content-Type: text/html

<html><body><table><tr><td>1</td></tr></table></body></html>
--b--
`;

const POSITIVE: [string, string, string][] = [
  ["SpreadsheetML .xml", SSML, "spreadsheetml"],
  ["SpreadsheetML with no declaration", SSML_BARE, "spreadsheetml"],
  ["Excel web page .htm", EXCEL_PAGE, "html"],
  ["a page export with mso-number-format", EXPORTED_PAGE, "html"],
  ["Excel single-file web page .mht", EXCEL_MHT, "html"],
];
const NEGATIVE: [string, string][] = [
  ["pom.xml", POM],
  ["RSS", RSS],
  ["SVG", SVG],
  ["ODF styles", ODF_STYLES],
  ["a Wikipedia-like page with a table", WIKI],
  ["a page saved from Word", WORD_PAGE],
  ["a page saved from PowerPoint", PPT_PAGE],
  ["an ordinary .mht page", PLAIN_MHT],
];

describe("spreadsheet export detection", () => {
  it.each(POSITIVE)("claims %s", (_, text, kind) => {
    expect(sheetExportKind(enc(text))).toBe(kind);
  });

  it.each(NEGATIVE)("leaves %s alone", (_, text) => {
    expect(sheetExportKind(enc(text))).toBeNull();
  });

  it("agrees with sheetedit under every strict name", () => {
    for (const [, text] of [...POSITIVE, ...NEGATIVE]) {
      for (const ext of [".xml", ".htm", ".html", undefined]) expect(sheetExportKind(enc(text))).toBe(sniffSheetText(enc(text), ext));
    }
  });

  it("reads UTF-16 with a BOM", () => {
    const body = SSML.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="UTF-16"?>');
    const u16 = new Uint8Array(2 + body.length * 2);
    u16.set([0xff, 0xfe]);
    for (let i = 0; i < body.length; i++) u16[2 + i * 2] = body.charCodeAt(i);
    expect(sheetExportKind(u16)).toBe("spreadsheetml");
  });

  it("checks only web page, XML, extension-less and unknown names", () => {
    const known = (ext: string) => [".xml", ".html", ".htm", ".json", ".txt", ".csv"].includes(ext);
    expect(sheetExportCandidate("book.xml", known)).toBe(".xml");
    expect(sheetExportCandidate("Book.HTM", known)).toBe(".htm");
    expect(sheetExportCandidate("book.mht", known)).toBe(".mht");
    expect(sheetExportCandidate("export", known)).toBe("");
    expect(sheetExportCandidate("export.dat", known)).toBe(".dat");
    expect(sheetExportCandidate("notes.txt", known)).toBeNull();
    expect(sheetExportCandidate("data.csv", known)).toBeNull();
  });

  it("routes exports to the sheet formats and the rest nowhere", async () => {
    const known = () => true;
    expect(await sheetExportFormatFor(enc(SSML), "book.xml", known)).toBe("xml-sheet");
    expect(await sheetExportFormatFor(enc(SSML), "book", known)).toBe("xml-sheet");
    expect(await sheetExportFormatFor(enc(EXCEL_PAGE), "book.htm", known)).toBe("html-sheet");
    expect(await sheetExportFormatFor(enc(EXCEL_MHT), "book.mht", known)).toBe("mht-sheet");
    for (const [, text] of NEGATIVE) expect(await sheetExportFormatFor(enc(text), "page.html", known)).toBeNull();
    expect(await sheetExportFormatFor(enc(SSML), "notes.txt", (e) => e === ".txt")).toBeNull();
  });
});

// The app's routing for a file, as openBuffer runs it, without the DOM.
const modules = import.meta.glob<Record<string, unknown>>(["./*.ts", "!./*.test.ts", "!./*.impl.ts"], { eager: true });
function registry(): FormatRegistry {
  const reg = new FormatRegistry();
  const seen = new Set<string>();
  const add = (f: FormatDescriptor) => {
    if (seen.has(f.manifest.id)) return;
    seen.add(f.manifest.id);
    reg.register(f);
  };
  for (const mod of Object.values(modules)) {
    for (const v of Object.values(mod)) {
      const f = v as FormatDescriptor;
      if (f && typeof f === "object" && f.manifest?.kind === "format" && typeof f.detect === "function") add(f);
    }
  }
  for (const f of [...makeTextFormats(), ...makeViewerFormats(), ...makeGenericViewerFormats()]) add(f);
  return reg;
}

async function route(reg: FormatRegistry, bytes: Uint8Array, filename: string): Promise<string> {
  const dot = filename.lastIndexOf(".");
  if (dot >= 0) {
    const all = reg.byExtension(filename.slice(dot));
    const head = bytes.subarray(0, 16);
    const bin = all.find((f) => f.manifest.binary && f.sniffBytes?.(head)) ?? (all[0]?.manifest.binary ? all[0] : undefined);
    if (bin) return bin.manifest.id;
  }
  const sniffed = contentFormatFor(bytes, filename, reg);
  if (sniffed) return sniffed.manifest.id;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (looksBinary(buf)) return "binary";
  const exported = await sheetExportFormatFor(bytes, filename, (ext) => reg.byExtension(ext).length > 0);
  if (exported) return exported;
  const sample = decodeBytes(buf).text.slice(0, 8192);
  return reg.detect({ filename, sample })?.descriptor.manifest.id ?? "plain text";
}

const editorOf = (reg: FormatRegistry, id: string): string => {
  const m = reg.byId(id)?.manifest;
  return m ? (m.defaultEditor ?? m.nativeEditor ?? m.viewAdapters?.[0] ?? "codemirror") : "codemirror";
};

describe("routing of ordinary files next to exports", () => {
  const reg = registry();
  it.each([
    ["book.xml", SSML, "xml-sheet"],
    ["book.htm", EXCEL_PAGE, "html-sheet"],
    ["pom.xml", POM, "xml"],
    ["feed.xml", RSS, "xml"],
    ["styles.xml", ODF_STYLES, "xml"],
    ["population.html", WIKI, "html"],
    ["report.htm", WORD_PAGE, "html"],
    ["slides.htm", PPT_PAGE, "html"],
  ])("opens %s as %s", async (name, text, id) => {
    expect(await route(reg, enc(text), name)).toBe(id);
  });

  it("sends exports to the sheet editor with the source one switch away", () => {
    for (const id of ["xml-sheet", "html-sheet", "mht-sheet"]) {
      const m = reg.byId(id)!.manifest;
      expect(m.defaultEditor).toBe("sheet");
      expect(m.nativeEditor).toBe("codemirror");
      expect(m.extensions).toEqual([]);
    }
    expect(reg.byId("html-sheet")!.manifest.viewAdapters).toContain("preview");
  });
});

// A local corpus run, off unless OT_SHEET_CORPUS names folders of samples (comma separated).
// Files are never committed; OT_SHEET_REPORT names a file to write the routing table to.
const dirs = (process.env.OT_SHEET_CORPUS ?? "").split(",").filter((d) => d && existsSync(d));
const corpus = dirs.flatMap((d) => readdirSync(d).filter((f) => !f.startsWith("_") && statSync(join(d, f)).isFile()).sort().map((f) => join(d, f)));

describe.skipIf(!corpus.length)("spreadsheet export corpus routing", () => {
  const reg = registry();
  const rows: string[] = [];
  for (const path of corpus) {
    it(path, async () => {
      const bytes = new Uint8Array(readFileSync(path));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const id = await route(reg, bytes, name);
      rows.push(`${name}\t${id}\t${editorOf(reg, id)}`);
      const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
      const strict = ext === ".xls" ? null : sniffSheetText(bytes, ext);
      if (strict) expect(editorOf(reg, id)).toBe("sheet");
      else if (ext !== ".xls") expect(id).not.toMatch(/-sheet$/);
    });
  }
  it("report", () => {
    if (process.env.OT_SHEET_REPORT) writeFileSync(process.env.OT_SHEET_REPORT, rows.join("\n") + "\n");
  });
});
