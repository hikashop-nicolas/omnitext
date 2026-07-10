import type { FormatModule, ParseResult } from "../core/types";

// .ics and .vcf are line-based text: the model is the text itself, so the raw text
// editor round-trips them byte-for-byte while the PIM viewer renders events/contacts.
export const pimImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
