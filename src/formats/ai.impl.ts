import type { FormatModule, ParseResult } from "../core/types";

// .ai is opaque bytes to the format layer; the AI viewer renders its PDF stream.
export const aiImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
