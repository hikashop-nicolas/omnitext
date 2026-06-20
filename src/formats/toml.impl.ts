import { StreamLanguage } from "@codemirror/language";
import { toml as tomlMode } from "@codemirror/legacy-modes/mode/toml";
import { parse } from "toml";
import type { Diagnostic, FormatModule, ParseResult } from "../core/types";
import { lineColToOffset } from "./_util";

function validate(text: string): Diagnostic[] {
  if (text.trim() === "") return [];
  try {
    parse(text);
    return [];
  } catch (err) {
    const e = err as { line?: number; column?: number; message?: string };
    const diag: Diagnostic = {
      severity: "error",
      message: e.message ?? (err instanceof Error ? err.message : String(err)),
    };
    if (typeof e.line === "number" && typeof e.column === "number") {
      const at = lineColToOffset(text, e.line, e.column);
      diag.from = at;
      diag.to = Math.min(at + 1, text.length);
    }
    return [diag];
  }
}

export const tomlImpl: FormatModule = {
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
    return StreamLanguage.define(tomlMode);
  },
};
