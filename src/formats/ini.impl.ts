import { StreamLanguage } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { parse } from "ini";
import type { Diagnostic, FormatModule, ParseResult } from "../core/types";

// INI parsing is lenient (the "ini" package rarely throws), so diagnostics are rare;
// editing stays byte-exact as a text-model format with .properties highlighting.
function validate(text: string): Diagnostic[] {
  if (text.trim() === "") return [];
  try {
    parse(text);
    return [];
  } catch (err) {
    return [{ severity: "error", message: err instanceof Error ? err.message : String(err) }];
  }
}

export const iniImpl: FormatModule = {
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
    return StreamLanguage.define(properties);
  },
};
