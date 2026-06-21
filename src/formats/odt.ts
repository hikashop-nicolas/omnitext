import type { FormatDescriptor } from "../core/types";

export const odtFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "odt",
    extensions: [".odt"],
    mimeTypes: ["application/vnd.oasis.opendocument.text"],
    binary: true,
    viewAdapters: ["odt"],
    defaultEditor: "odt",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./odt.impl").then((m) => m.odtImpl),
};
