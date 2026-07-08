import type { FormatDescriptor } from "../core/types";

// PowerPoint presentations, read-only. Rendered by the pptx editor
// (@aiden0z/pptx-renderer, Apache-2.0) as a scrollable list of DOM/SVG slides.
// A .pptx is a zip, so the archive viewer is offered as an alternative view.
export const pptxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "pptx",
    extensions: [".pptx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    binary: true,
    nativeEditor: "pptx",
    viewAdapters: ["archive"],
  },
  detect: () => 0, // detected by extension
  load: () => import("./bytes.impl").then((m) => m.bytesImpl),
};
