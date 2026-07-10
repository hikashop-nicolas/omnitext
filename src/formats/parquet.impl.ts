import type { FormatModule, ParseResult } from "../core/types";

// A Parquet file is opaque bytes to the format layer; the viewer reads it (hyparquet).
export const parquetImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
