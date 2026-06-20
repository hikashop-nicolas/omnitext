import { javascript } from "@codemirror/lang-javascript";
import type { FormatModule, ParseResult } from "../core/types";

function make(opts: { typescript?: boolean; jsx?: boolean }): FormatModule {
  return {
    parse(text): ParseResult {
      return { ok: true, model: text, diagnostics: [] };
    },
    serialize(model) {
      return String(model);
    },
    language() {
      return javascript(opts);
    },
  };
}

export const jsImpl = make({ jsx: true });
export const tsImpl = make({ typescript: true, jsx: true });
