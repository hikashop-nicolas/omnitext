import type { FormatDescriptor } from "../core/types";

// Adobe Illustrator (.ai): binary, opened read-only in the AI viewer, which renders the
// file's PDF-compatible stream with pdf.js.
export const aiFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ai",
    extensions: [".ai"],
    mimeTypes: ["application/illustrator", "application/postscript"],
    binary: true,
    nativeEditor: "aiviewer",
    defaultEditor: "aiviewer",
    soleEditor: true,
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./ai.impl").then((m) => m.aiImpl),
};
