import type { FormatDescriptor } from "../core/types";

// Rich Text Format, read-only. Rendered by the rtf editor (rtf.js). Marked binary so the byte
// stream reaches the renderer untouched (RTF carries codepage bytes) and the text fallback is
// skipped - there is no editing surface, only the rendered view.
export const rtfFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "rtf",
    extensions: [".rtf"],
    mimeTypes: ["application/rtf", "text/rtf"],
    binary: true,
    viewAdapters: ["rtf"],
    defaultEditor: "rtf",
  },
  detect: () => 0, // detected by extension
  load: () => import("./rtf.impl").then((m) => m.rtfImpl),
};
