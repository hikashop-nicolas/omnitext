import type { FormatModule, ParseResult } from "../core/types";

// Legacy .doc (binary). The model holds the original bytes; the doc editor (richdoc) reads,
// edits, and re-exports them via its getBytes(). serializeBinary is a fallback.
export const docImpl: FormatModule = {
  parse() {
    throw new Error("doc is a binary format; use parseBinary");
  },
  serialize() {
    throw new Error("doc is a binary format; use serializeBinary");
  },
  parseBinary(bytes): ParseResult {
    return { ok: true, model: { bytes }, diagnostics: [] };
  },
  serializeBinary(model) {
    return (model as { bytes: Uint8Array }).bytes;
  },
};
