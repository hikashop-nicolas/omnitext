import type { FormatDescriptor, FormatModule } from "../core/types";

// Spreadsheet exports saved as text under a web page or XML name: Excel 2003 XML (SpreadsheetML),
// Excel's "Save as Web Page" and its single-file .mht. They open in the sheet editor, the source
// one switch away, and Save writes a new .xlsx (see the sheet editor's saveConverts).

export type SheetExportKind = "html" | "spreadsheetml";

const SSML_NS = "urn:schemas-microsoft-com:office:spreadsheet";
const EXCEL_NS = "urn:schemas-microsoft-com:office:excel";

/** Extensions whose files are checked by content; files with none or an unknown one are too. */
const EXPORT_EXTS = new Set([".xml", ".htm", ".html", ".mht", ".mhtml"]);

function headText(b: Uint8Array, n = 65536): string {
  const le = b[0] === 0xff && b[1] === 0xfe, be = b[0] === 0xfe && b[1] === 0xff;
  const le0 = b[0] === 0x3c && b[1] === 0 && b[3] === 0, be0 = b[0] === 0 && b[1] === 0x3c && b[2] === 0;
  if (le || be || le0 || be0) {
    try {
      return new TextDecoder(le || le0 ? "utf-16le" : "utf-16be").decode(b.subarray(le || be ? 2 : 0, Math.min(b.length, n * 2)));
    } catch {
      return "";
    }
  }
  const from = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  let s = "";
  const end = Math.min(b.length, from + n);
  for (let i = from; i < end; i++) s += String.fromCharCode(b[i]!);
  return s;
}

/**
 * A quick check of the first bytes with the markers sheetedit's sniffSheetText uses for names other
 * than .xls: only clear spreadsheet exports, so ordinary pages and XML files keep their viewers.
 */
export function sheetExportKind(bytes: Uint8Array): SheetExportKind | null {
  if (bytes.length < 6) return null;
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) return null;
  const head = headText(bytes);
  const trimmed = head.replace(/^﻿/, "").replace(/^(?:\s+|<!--[\s\S]*?-->)*/, "");
  if (/^<\?xml\b/i.test(trimmed) || /^<(?:[\w-]+:)?Workbook\b/.test(trimmed)) {
    const root = /<(?:([\w-]+):)?Workbook\b([^>]*)>/.exec(head);
    if (root && root[2]!.includes(SSML_NS)) return "spreadsheetml";
    if (root && /<\?mso-application\s+progid\s*=\s*["']Excel\.Sheet["']/i.test(head)) return "spreadsheetml";
    if (!/<html\b/i.test(head)) return null;
  }
  if (/^\s*(?:MIME-Version:|Content-Type:\s*multipart\/related)/i.test(head)) return head.includes(EXCEL_NS) || /Excel\.Sheet/i.test(head) ? "html" : null;
  const page = trimmed.replace(/^(?:\s+|<!--[\s\S]*?-->|<\?xml[^>]*\?>)*/, "");
  if (!/^<(?:!doctype\s+html|html|head|body|meta|title|style|table|link|div|p|h[1-6]|span|center|font|b|br|form)\b/i.test(page)) return null;
  const strong = head.includes(EXCEL_NS) || /<meta\b[^>]*ProgId[^>]*Excel\.Sheet/i.test(head) || /mso-number-format|<x:ExcelWorkbook|\sx:(?:num|str|fmla)\b/i.test(head);
  return strong ? "html" : null;
}

/** Whether a file of this name is checked by content: an export extension, none, or one no format claims. */
export function sheetExportCandidate(filename: string, knownExtension: (ext: string) => boolean): string | null {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  return !ext || EXPORT_EXTS.has(ext) || !knownExtension(ext) ? ext : null;
}

/** The format to open a text file in when it is a spreadsheet export, confirmed by sheetedit; else null. */
export async function sheetExportFormatFor(bytes: Uint8Array, filename: string, knownExtension: (ext: string) => boolean): Promise<string | null> {
  const ext = sheetExportCandidate(filename, knownExtension);
  if (ext === null) return null;
  const quick = sheetExportKind(bytes);
  if (!quick) return null;
  const kind = await import("./sheet-export.impl").then((m) => m.confirmSheetExport(bytes, ext)).catch(() => quick);
  if (!kind) return null;
  if (kind === "spreadsheetml") return xmlSheetFormat.manifest.id;
  return /^\s*(?:MIME-Version:|Content-Type:)/i.test(headText(bytes, 512)) ? mhtSheetFormat.manifest.id : htmlSheetFormat.manifest.id;
}

const plainImpl: FormatModule = {
  parse: (text) => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};

// No extensions: these are reached only by the content check above, never by name.
export const xmlSheetFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "xml-sheet",
    extensions: [],
    mimeTypes: ["application/xml"],
    nativeEditor: "codemirror",
    viewAdapters: ["sheet"],
    defaultEditor: "sheet",
  },
  detect: () => 0,
  load: () => import("./xml.impl").then((m) => m.xmlImpl),
};

export const htmlSheetFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "html-sheet",
    extensions: [],
    mimeTypes: ["text/html"],
    nativeEditor: "codemirror",
    viewAdapters: ["sheet", "richtext", "preview"],
    defaultEditor: "sheet",
  },
  detect: () => 0,
  load: () => import("./html.impl").then((m) => m.htmlImpl),
};

export const mhtSheetFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "mht-sheet",
    extensions: [],
    mimeTypes: [],
    nativeEditor: "codemirror",
    viewAdapters: ["sheet"],
    defaultEditor: "sheet",
  },
  detect: () => 0,
  load: () => Promise.resolve(plainImpl),
};

export const sheetExportFormats = [xmlSheetFormat, htmlSheetFormat, mhtSheetFormat];
