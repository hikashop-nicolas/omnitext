import { StreamLanguage } from "@codemirror/language";
import { toml as tomlMode } from "@codemirror/legacy-modes/mode/toml";
import { parse } from "toml";
import type { Diagnostic, FormatModule, ParseResult } from "../core/types";
import { lineColToOffset } from "./_util";

function validate(text: string): Diagnostic[] {
  if (text.trim() === "") return [];
  try {
    // bigint: true, or every integer past 2^53 is reported as an error in a file that is
    // perfectly valid TOML. We only want the diagnostics, so the BigInts themselves cost nothing.
    parse(text, { bigint: true });
    return [];
  } catch (err) {
    type Pos = { offset?: number; line?: number; column?: number };
    const e = err as { location?: { start?: Pos; end?: Pos }; line?: number; column?: number; message?: string };
    const diag: Diagnostic = {
      severity: "error",
      message: e.message ?? (err instanceof Error ? err.message : String(err)),
    };
    // The parser reports where it gave up under `location`, as an offset we can use directly.
    // It has no `line`/`column` of its own, so that route only covers a thrown Error from
    // elsewhere in the library (an out-of-range integer, say) that carries one.
    const start = e.location?.start;
    if (typeof start?.offset === "number") {
      diag.from = Math.min(start.offset, text.length);
      diag.to = Math.min(Math.max(e.location?.end?.offset ?? start.offset + 1, diag.from + 1), text.length);
    } else if (typeof e.line === "number" && typeof e.column === "number") {
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
