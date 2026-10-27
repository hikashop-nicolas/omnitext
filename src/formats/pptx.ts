import type { FormatDescriptor } from "../core/types";

// PowerPoint presentations: edited by pptxcraft where the engine is built in, else shown read-only by the pptx editor
// (@aiden0z/pptx-renderer, Apache-2.0) as a scrollable list of DOM/SVG slides,
// with a fullscreen presentation mode.
export const pptxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "pptx",
    extensions: [".pptx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    binary: true,
    nativeEditor: "pptx",
    viewAdapters: ["pptx"],
  },
  detect: () => 0, // detected by extension
  load: () => import("./bytes.impl").then((m) => m.bytesImpl),
};
