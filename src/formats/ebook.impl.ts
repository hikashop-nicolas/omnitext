import type { FormatModule, ParseResult } from "../core/types";

// An ebook is opaque bytes to the format layer; the foliate-js viewer parses it.
export const ebookImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
