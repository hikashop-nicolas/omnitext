import type { FormatModule, ParseResult } from "../core/types";

// Spreadsheet behavior (binary), shared by .xlsx and .ods. The model holds the original
// bytes; the sheet editor (sheetedit) reads, edits with formula recalculation, and
// re-exports them in place via its getBytes(). serializeBinary is a fallback (returns
// the original) since the editor owns export.
export const sheetBinaryImpl: FormatModule = {
  parse() {
    throw new Error("spreadsheet is a binary format; use parseBinary");
  },
  serialize() {
    throw new Error("spreadsheet is a binary format; use serializeBinary");
  },
  parseBinary(bytes): ParseResult {
    return { ok: true, model: { bytes }, diagnostics: [] };
  },
  serializeBinary(model) {
    return (model as { bytes: Uint8Array }).bytes;
  },
};
