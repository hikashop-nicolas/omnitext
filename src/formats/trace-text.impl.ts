import type { FormatModule, ParseResult } from "../core/types";

// Text traces are read by the trace viewer; the format keeps the text as it is.
export const traceTextImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
