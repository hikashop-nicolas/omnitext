import type { FormatModule, ParseResult } from "../core/types";

// A HEIC/HEIF image is opaque bytes to the format layer; the viewer decodes it (libheif).
export const heicImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
