import type { FormatDescriptor } from "../core/types";

export const xlsFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "xls",
    extensions: [".xls"],
    mimeTypes: ["application/vnd.ms-excel"],
    binary: true,
    // sheetedit reads BIFF2-8 with every sheet and its formatting, and saves BIFF8.
    viewAdapters: ["sheet"],
    defaultEditor: "sheet",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./sheet.impl").then((m) => m.xlsSheetImpl),
};

/** Text in the first bytes: a web page or XML spreadsheet some apps export under an .xls name. */
export function looksLikeXlsText(head: Uint8Array): boolean {
  if (!head.length) return false;
  if ((head[0] === 0xef && head[1] === 0xbb) || (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) return true;
  return head.every((b) => b >= 0x20 || b === 0x09 || b === 0x0a || b === 0x0d);
}

/** An HTML or Excel 2003 XML table saved as .xls: sheetedit reads it and saves a real .xls. */
export const xlsTextFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "xls-html",
    extensions: [".xls"],
    binary: true,
    viewAdapters: ["sheet"],
    defaultEditor: "sheet",
  },
  detect: () => 0,
  sniffBytes: looksLikeXlsText,
  load: () => import("./sheet.impl").then((m) => m.sheetBinaryImpl),
};
