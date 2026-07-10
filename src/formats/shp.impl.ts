import type { FormatModule, ParseResult } from "../core/types";

// Shapefile is opaque bytes to the format layer; the geoeditor (geoedit) parses it with
// shpjs and renders it read-only. These pass-throughs just satisfy the contract.
export const shpImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
