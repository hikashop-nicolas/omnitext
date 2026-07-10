import type { FormatModule, ParseResult } from "../core/types";

// KMZ is opaque bytes to the format layer; the geoeditor unzips/re-zips it (it owns the
// inner-KML editing + archive round-trip). These pass-throughs just satisfy the contract.
export const kmzImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  parseBinary: (bytes): ParseResult => ({ ok: true, model: bytes, diagnostics: [] }),
  serializeBinary: (model) => model as Uint8Array,
};
