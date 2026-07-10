import type { FormatModule, ParseResult } from "../core/types";

// A TIFF is opaque bytes to the format layer; the TIFF viewer decodes it (UTIF.js).
export const tiffImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
