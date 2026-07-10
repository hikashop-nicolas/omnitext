import type { FormatModule, ParseResult } from "../core/types";

// Arrow/Avro files are opaque bytes to the format layer; the records viewer decodes them.
export const recordsImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
