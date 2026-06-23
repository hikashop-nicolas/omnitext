import { xml } from "@codemirror/lang-xml";
import type { FormatModule, ParseResult } from "../core/types";

// SVG is XML text: identity parse/serialize, with XML highlighting for the source view.
export const svgImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  language: () => xml(),
};
