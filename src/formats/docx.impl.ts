import type { FormatModule, ParseResult } from "../core/types";

// DOCX behavior (binary). The model holds the original bytes; the docx editor (docxedit)
// reads, edits, and re-exports them via its getBytes(). serializeBinary is a fallback
// (returns the original) since the editor owns export.
export const docxImpl: FormatModule = {
  parse() {
    throw new Error("docx is a binary format; use parseBinary");
  },
  serialize() {
    throw new Error("docx is a binary format; use serializeBinary");
  },
  parseBinary(bytes): ParseResult {
    return { ok: true, model: { bytes }, diagnostics: [] };
  },
  serializeBinary(model) {
    return (model as { bytes: Uint8Array }).bytes;
  },
};
