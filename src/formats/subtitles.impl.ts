import type { FormatModule, ParseResult } from "../core/types";

// SRT / VTT / ASS / SSA are line-based text formats: identity parse/serialize. The subedit
// editor holds the source text and edits it byte-faithfully; the CodeMirror text view is
// the universal fallback. Shared by every subtitle format descriptor.
export const subtitlesImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
