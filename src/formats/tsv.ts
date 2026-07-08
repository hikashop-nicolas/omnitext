import type { FormatDescriptor } from "../core/types";

export const tsvFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "tsv",
    extensions: [".tsv"],
    mimeTypes: ["text/tab-separated-values"],
    viewAdapters: ["sheet", "table"],
    defaultEditor: "sheet",
  },
  detect({ sample }) {
    const firstLine = sample.split(/\r\n|\r|\n/, 1)[0] ?? "";
    return firstLine.includes("\t") ? 0.4 : 0;
  },
  load: () => import("./tsv.impl").then((m) => m.tsvImpl),
};
