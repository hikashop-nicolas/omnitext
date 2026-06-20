import type { FormatDescriptor } from "../core/types";

export const pdfFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    binary: true,
    viewAdapters: ["pdf"],
    defaultEditor: "pdf",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./pdf.impl").then((m) => m.pdfImpl),
};
