import { json } from "@codemirror/lang-json";
import type { Diagnostic, FormatModule, ParseResult } from "../core/types";

// JSON is a text-model format: the canonical text IS the model, so editing is
// byte-exact. We add syntax-error diagnostics and CodeMirror highlighting. (Schema
// validation via ajv can be layered on later when a schema is associated.)

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

export const jsonFormat: FormatModule = {
  manifest: {
    kind: "format",
    id: "json",
    extensions: [".json"],
    mimeTypes: ["application/json"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    const s = sample.trimStart();
    return s.startsWith("{") || s.startsWith("[") ? 0.6 : 0;
  },
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
