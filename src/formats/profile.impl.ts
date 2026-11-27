import type { FormatModule, ParseResult } from "../core/types";

// Profiles are read by the profile viewer; the format keeps the text or bytes as they are.
export const profileImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
