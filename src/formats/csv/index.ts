import type { FormatDescriptor } from "../../core/types";

export const csvFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "csv",
    extensions: [".csv"],
    mimeTypes: ["text/csv"],
    viewAdapters: ["table"],
  },
  detect({ sample }) {
    const firstLine = sample.split(/\r\n|\r|\n/, 1)[0] ?? "";
    return firstLine.includes(",") ? 0.4 : 0;
  },
  load: () => import("./impl").then((m) => m.csvImpl),
};
