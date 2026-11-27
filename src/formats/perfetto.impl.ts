import type { FormatModule, ParseResult } from "../core/types";

// A Perfetto trace is opaque bytes to the format layer; the viewer reads it.
export const perfettoImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
