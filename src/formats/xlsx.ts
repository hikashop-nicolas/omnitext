import type { FormatDescriptor } from "../core/types";

export const xlsxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "xlsx",
    extensions: [".xlsx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    binary: true,
    viewAdapters: ["table"],
    defaultEditor: "table",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./xlsx.impl").then((m) => m.xlsxImpl),
};
