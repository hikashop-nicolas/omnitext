import { xml } from "@codemirror/lang-xml";
import { XMLValidator } from "fast-xml-parser";
import type { Diagnostic, FormatModule, ParseResult } from "../core/types";
import { lineColToOffset } from "./_util";

function validate(text: string): Diagnostic[] {
  if (text.trim() === "") return [];
  const result = XMLValidator.validate(text, { allowBooleanAttributes: true });
  if (result === true) return [];
  const { msg, line, col } = result.err;
  const at = lineColToOffset(text, line, col);
  return [{ severity: "error", message: msg, from: at, to: Math.min(at + 1, text.length) }];
}

export const xmlImpl: FormatModule = {
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
    return xml();
  },
};
