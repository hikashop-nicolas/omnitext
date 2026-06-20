import type { FormatDescriptor } from "../core/types";

export const typescriptFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    mimeTypes: ["text/typescript"],
    nativeEditor: "codemirror",
  },
  detect() {
    return 0;
  },
  load: () => import("./javascript.impl").then((m) => m.tsImpl),
};
