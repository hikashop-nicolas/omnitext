import { css } from "@codemirror/lang-css";
import type { FormatModule, ParseResult } from "../core/types";

export const cssImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  language() {
    return css();
  },
};
