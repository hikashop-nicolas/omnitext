import type { FormatModule, ParseResult } from "../core/types";

// A SQLite database is opaque bytes to the format layer; the viewer opens it via sql.js.
export const sqliteImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
