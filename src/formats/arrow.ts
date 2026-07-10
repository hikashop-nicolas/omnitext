import type { FormatDescriptor } from "../core/types";

// Apache Arrow IPC / Feather (.arrow/.feather): binary columnar data, opened read-only in
// the records grid viewer. Arrow IPC streams begin with the "ARROW1" magic or a schema
// message; routed by extension.
export const arrowFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "arrow",
    extensions: [".arrow", ".feather", ".ipc"],
    mimeTypes: ["application/vnd.apache.arrow.file"],
    binary: true,
    nativeEditor: "recordsviewer",
    defaultEditor: "recordsviewer",
    soleEditor: true,
  },
  detect: ({ sample }) => (sample.startsWith("ARROW1") ? 1 : 0),
  load: () => import("./records.impl").then((m) => m.recordsImpl),
};
