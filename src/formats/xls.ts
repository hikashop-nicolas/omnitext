import type { FormatDescriptor } from "../core/types";

export const xlsFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "xls",
    extensions: [".xls"],
    mimeTypes: ["application/vnd.ms-excel"],
    binary: true,
    viewAdapters: ["table"],
    defaultEditor: "table",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./xlsx.impl").then((m) => m.xlsImpl),
};
