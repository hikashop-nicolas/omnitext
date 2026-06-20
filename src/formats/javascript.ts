import type { FormatDescriptor } from "../core/types";

export const javascriptFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "javascript",
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
    mimeTypes: ["text/javascript", "application/javascript"],
    nativeEditor: "codemirror",
  },
  detect() {
    return 0;
  },
  load: () => import("./javascript.impl").then((m) => m.jsImpl),
};
