import { StreamLanguage } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import type { FormatModule, ParseResult } from "../core/types";

// Shared behavior for key=value config files (.properties and .env). Text-model,
// byte-exact, with the .properties legacy-modes highlighting.
export const propertiesImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  language() {
    return StreamLanguage.define(properties);
  },
};
