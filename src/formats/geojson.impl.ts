import type { FormatModule, ParseResult } from "../core/types";

// GeoJSON is JSON text: identity parse/serialize. The geoeditor is the only surface
// (soleEditor); it holds the source string and edits it losslessly with jsonc-parser.
export const geojsonImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
