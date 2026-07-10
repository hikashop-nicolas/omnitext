import type { FormatModule, ParseResult } from "../core/types";

// A 3D model is opaque bytes to the format layer; the model viewer parses it (three.js).
export const model3dImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
