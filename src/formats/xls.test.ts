// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { blankWorkbookBytes, sniffSheetText } from "sheetedit";
import { looksLikeXlsText, xlsFormat, xlsTextFormat } from "./xls";
import { xlsSheetImpl } from "./sheet.impl";

const realXls = (): Uint8Array => blankWorkbookBytes("xls");

describe(".xls", () => {
  it("opens in the sheet editor by default", () => {
    expect(xlsFormat.manifest.defaultEditor).toBe("sheet");
    expect(xlsFormat.manifest.viewAdapters).toEqual(["sheet"]);
  });

  it("reads a real workbook and refuses a damaged one", () => {
    const bytes = realXls();
    expect(xlsSheetImpl.parseBinary!(bytes).ok).toBe(true);
    const damaged = bytes.slice(0, 600);
    expect(() => xlsSheetImpl.parseBinary!(damaged)).toThrow();
  });

  it("sends an HTML or XML table saved as .xls to the sheet editor", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(looksLikeXlsText(enc("<html><table>"))).toBe(true);
    expect(looksLikeXlsText(enc('<?xml version="1.0"?>'))).toBe(true);
    expect(looksLikeXlsText(realXls().subarray(0, 16))).toBe(false);
    expect(looksLikeXlsText(new Uint8Array([0x09, 0x08, 0x10, 0x00]))).toBe(false); // raw BIFF
    expect(looksLikeXlsText(enc("PK\u0003\u0004"))).toBe(false);
    expect(xlsTextFormat.manifest.defaultEditor).toBe("sheet");
    expect(sniffSheetText(enc("<html><body><table><tr><td>1</td></tr></table></body></html>"), ".xls")).toBe("html");
  });
});
