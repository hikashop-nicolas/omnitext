import type { FormatModule, ParseResult } from "../core/types";

// Opaque bytes to the format layer; the dedicated viewer decodes them.
export const dxfImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
