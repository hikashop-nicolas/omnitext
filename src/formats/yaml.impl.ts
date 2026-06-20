import { yaml } from "@codemirror/lang-yaml";
import { load, YAMLException } from "js-yaml";
import type { Diagnostic, FormatModule, ParseResult } from "../core/types";

function validate(text: string): Diagnostic[] {
  if (text.trim() === "") return [];
  try {
    load(text);
    return [];
  } catch (err) {
    if (err instanceof YAMLException) {
      const at = err.mark?.position;
      return [
        {
          severity: "error",
          message: err.reason || err.message,
          ...(typeof at === "number" ? { from: at, to: Math.min(at + 1, text.length) } : {}),
        },
      ];
    }
    return [{ severity: "error", message: err instanceof Error ? err.message : String(err) }];
  }
}

export const yamlImpl: FormatModule = {
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
    return yaml();
  },
};
