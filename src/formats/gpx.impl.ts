import type { FormatModule, ParseResult } from "../core/types";

// GPX is XML text: identity parse/serialize. The geoeditor is the only surface
// (soleEditor); it holds the source string and splices it losslessly on edit.
export const gpxImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
