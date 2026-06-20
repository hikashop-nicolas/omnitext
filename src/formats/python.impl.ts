import { python } from "@codemirror/lang-python";
import type { FormatModule, ParseResult } from "../core/types";

export const pythonImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  language() {
    return python();
  },
};
