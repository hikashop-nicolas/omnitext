import { json } from "@codemirror/lang-json";
import type { Diagnostic, FormatModule, ParseResult } from "../core/types";

// JSON behavior (lazy-loaded). Text-model: the canonical text is the model, so
// editing is byte-exact. We add syntax-error diagnostics and CodeMirror highlighting.

function validate(text: string): Diagnostic[] {
  if (text.trim() === "") return [];
  try {
    JSON.parse(text);
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const m = /position (\d+)/.exec(message);
    const at = m ? Number(m[1]) : undefined;
    return [
      {
        severity: "error",
        message,
        ...(at !== undefined ? { from: at, to: Math.min(at + 1, text.length) } : {}),
      },
    ];
  }
}

export const jsonImpl: FormatModule = {
  parse(text): ParseResult {
    const diagnostics = validate(text);
    return { ok: diagnostics.length === 0, model: text, diagnostics };
  },
  serialize(model) {
    return String(model);
  },
  validate(_model, text) {
    return validate(text);
  },
  language() {
    return json();
  },
};
