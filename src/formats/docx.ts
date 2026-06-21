import type { FormatDescriptor } from "../core/types";

export const docxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "docx",
    extensions: [".docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    binary: true,
    viewAdapters: ["docx"],
    defaultEditor: "docx",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./docx.impl").then((m) => m.docxImpl),
};
