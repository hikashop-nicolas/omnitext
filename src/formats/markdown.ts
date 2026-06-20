import type { FormatDescriptor } from "../core/types";

export const markdownFormat: FormatDescriptor = {
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
  load: () => import("./markdown.impl").then((m) => m.markdownImpl),
};
