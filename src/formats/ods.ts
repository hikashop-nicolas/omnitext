import type { FormatDescriptor } from "../core/types";

export const odsFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ods",
    extensions: [".ods"],
    mimeTypes: ["application/vnd.oasis.opendocument.spreadsheet"],
    binary: true,
    viewAdapters: ["sheet"],
    defaultEditor: "sheet",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./sheet.impl").then((m) => m.sheetBinaryImpl),
};
