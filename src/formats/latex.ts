import type { FormatDescriptor } from "../core/types";

// LaTeX: a text format edited in CodeMirror (stex highlighting) with a rendered HTML
// preview as an alternative view (the latexpreview editor, via latex.js).
export const latexFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "latex",
    extensions: [".tex", ".latex", ".ltx", ".sty", ".cls", ".dtx", ".ins"],
    mimeTypes: ["text/x-tex", "application/x-tex"],
    nativeEditor: "codemirror",
    viewAdapters: ["latex"],
  },
  detect() {
    return 0;
  },
  load: () => import("./latex.impl").then((m) => m.latexImpl),
};
