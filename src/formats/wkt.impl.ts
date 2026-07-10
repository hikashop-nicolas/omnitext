import type { FormatModule, ParseResult } from "../core/types";

// Identity text: the geoeditor owns the WKT -> GeoJSON conversion for display.
export const wktImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
