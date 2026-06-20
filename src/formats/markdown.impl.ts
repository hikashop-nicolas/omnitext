import { markdown } from "@codemirror/lang-markdown";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { FormatModule, ParseResult, PreviewView, ViewKind } from "../core/types";

// Markdown behavior (lazy-loaded). Text-model: byte-exact editing plus highlighting,
// and a "preview" view rendered with marked and sanitized with DOMPurify.
export const markdownImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  toView(model, view: ViewKind): unknown {
    if (view !== "preview") throw new Error(`markdown cannot project to view "${view}"`);
    const rendered = marked.parse(String(model), { async: false });
    const out: PreviewView = { html: DOMPurify.sanitize(rendered), sandbox: false };
    return out;
  },
  language() {
    return markdown();
  },
};
