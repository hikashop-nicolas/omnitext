import { markdown } from "@codemirror/lang-markdown";
import type { FormatModule, ParseResult } from "../core/types";

// Markdown is a text-model format: byte-exact editing, plus CodeMirror highlighting.
export const markdownFormat: FormatModule = {
  manifest: {
    kind: "format",
    id: "markdown",
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    // Weak heuristic; the extension match in the registry dominates. Returns 0 when
    // there are no markers so a blank/unknown doc falls back to plain text, not MD.
    return /^#{1,6}\s|\[.+\]\(.+\)|^[-*]\s/m.test(sample) ? 0.3 : 0;
  },
  parse(text): ParseResult {
    return { ok: true, model: text, diagnostics: [] };
  },
  serialize(model) {
    return String(model);
  },
  language() {
    return markdown();
  },
};
