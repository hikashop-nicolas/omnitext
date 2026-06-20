import { markdown } from "@codemirror/lang-markdown";
import type { FormatModule, ParseResult } from "../core/types";

// Markdown behavior (lazy-loaded). Text-model: byte-exact editing plus highlighting.
export const markdownImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  language() {
    return markdown();
  },
};
