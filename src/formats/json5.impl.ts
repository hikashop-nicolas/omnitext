import { json } from "@codemirror/lang-json";
import JSON5 from "json5";
import type {
  Diagnostic,
  FormatModule,
  ParseResult,
  TreeView,
  ViewKind,
} from "../core/types";
import { lineColToOffset } from "./_util";

function validate(text: string): Diagnostic[] {
  if (text.trim() === "") return [];
  try {
    JSON5.parse(text);
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const e = err as { lineNumber?: number; columnNumber?: number };
    const diag: Diagnostic = { severity: "error", message };
    if (typeof e.lineNumber === "number" && typeof e.columnNumber === "number") {
      const at = lineColToOffset(text, e.lineNumber, e.columnNumber);
      diag.from = at;
      diag.to = Math.min(at + 1, text.length);
    }
    return [diag];
  }
}

// JSON5 reuses the JSON CodeMirror language for highlighting (close enough; it adds
// comments and unquoted keys, which highlight acceptably).
export const json5Impl: FormatModule = {
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
  toView(model, view: ViewKind): unknown {
    if (view !== "tree") throw new Error(`json5 cannot project to view "${view}"`);
    const out: TreeView = {
      value: JSON5.parse(String(model)),
      stringify: (v) => JSON5.stringify(v, null, 2),
    };
    return out;
  },
  language() {
    return json();
  },
};
