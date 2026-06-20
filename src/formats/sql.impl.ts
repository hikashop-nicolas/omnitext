import { sql } from "@codemirror/lang-sql";
import type { FormatModule, ParseResult } from "../core/types";

export const sqlImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  language() {
    return sql();
  },
};
