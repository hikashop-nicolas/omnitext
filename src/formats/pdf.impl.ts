import type { FormatModule, ParseResult } from "../core/types";

// PDF behavior (binary). The model holds the original bytes; the pdf editor renders
// and edits them and produces the exported bytes via its getBytes(). serializeBinary
// is a fallback (returns the original) since the editor owns export.
export const pdfImpl: FormatModule = {
  parse() {
    throw new Error("pdf is a binary format; use parseBinary");
  },
  serialize() {
    throw new Error("pdf is a binary format; use serializeBinary");
  },
  parseBinary(bytes): ParseResult {
    return { ok: true, model: { bytes }, diagnostics: [] };
  },
  serializeBinary(model) {
    return (model as { bytes: Uint8Array }).bytes;
  },
};
