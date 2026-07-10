import { json } from "@codemirror/lang-json";
import type { FormatModule, ParseResult } from "../core/types";

// An .ipynb is JSON text: the model is the text itself, so the raw text editor round-
// trips it byte-for-byte with JSON highlighting, while the notebook viewer renders it.
export const ipynbImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
  language() {
    return json();
  },
};
