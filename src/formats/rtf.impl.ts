import type { FormatModule, ParseResult } from "../core/types";

// RTF behavior (binary, read-only). RTF is rendered by the rtf editor via rtf.js; there is no
// edit/serialize path, so the model just holds the original bytes and serializeBinary returns
// them unchanged (a no-op save preserves the file).
export const rtfImpl: FormatModule = {
  parse() {
    throw new Error("rtf is a binary format; use parseBinary");
  },
  serialize() {
    throw new Error("rtf is a binary format; use serializeBinary");
  },
  parseBinary(bytes): ParseResult {
    return { ok: true, model: { bytes }, diagnostics: [] };
  },
  serializeBinary(model) {
    return (model as { bytes: Uint8Array }).bytes;
  },
};
