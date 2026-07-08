import type { FormatModule, ParseResult } from "../core/types";

// Shared behavior for view-only binary formats (pptx, epub): the model holds the
// original bytes and a no-op save returns them unchanged.
export const bytesImpl: FormatModule = {
  parse() {
    throw new Error("binary format; use parseBinary");
  },
  serialize() {
    throw new Error("binary format; use serializeBinary");
  },
  parseBinary(bytes): ParseResult {
    return { ok: true, model: { bytes }, diagnostics: [] };
  },
  serializeBinary(model) {
    return (model as { bytes: Uint8Array }).bytes;
  },
};
