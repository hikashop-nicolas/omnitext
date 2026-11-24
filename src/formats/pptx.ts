import type { FormatDescriptor } from "../core/types";

// PowerPoint presentations, edited by pptxcraft on DeckCraft's engine. A build without the engine opens them as bytes.
export const pptxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "pptx",
    extensions: [".pptx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    binary: true,
    nativeEditor: "pptxcraft",
    viewAdapters: ["pptx"],
  },
  detect: () => 0, // detected by extension
  load: () => import("./bytes.impl").then((m) => m.bytesImpl),
};
