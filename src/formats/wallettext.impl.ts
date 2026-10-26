import type { FormatModule, ParseResult } from "../core/types";

// Health cards and boarding pass strings are plain text: the model is the text itself, so the
// raw text editor round-trips them byte-for-byte while the wallet viewer draws the card.
export const walletTextImpl: FormatModule = {
  parse: (text): ParseResult => ({ ok: true, model: text, diagnostics: [] }),
  serialize: (model) => String(model),
};
