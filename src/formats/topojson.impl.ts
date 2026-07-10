import type { FormatModule, ParseResult } from "../core/types";

// Identity text: the geoeditor owns the TopoJSON -> GeoJSON conversion for display.
export const topojsonImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
