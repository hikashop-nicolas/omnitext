import { html } from "@codemirror/lang-html";
import type { FormatModule, ParseResult, PreviewView, ViewKind } from "../core/types";

// HTML behavior. Text-model source editing plus a sandboxed preview. The preview
// renders the raw HTML in a sandboxed iframe (no scripts), so untrusted markup is safe.
export const htmlImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  toView(model, view: ViewKind): unknown {
    if (view !== "preview") throw new Error(`html cannot project to view "${view}"`);
    const out: PreviewView = { html: String(model), sandbox: true };
    return out;
  },
  language() {
    return html();
  },
};
