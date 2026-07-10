import type { FormatModule, ParseResult } from "../core/types";

// PSD is opaque bytes to the format layer; the PSD viewer parses/composites them.
export const psdImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
