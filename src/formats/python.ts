import type { FormatDescriptor } from "../core/types";

export const pythonFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "python",
    extensions: [".py", ".pyw"],
    mimeTypes: ["text/x-python"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /^\s*(def|class|import|from)\s/m.test(sample) ? 0.3 : 0;
  },
  load: () => import("./python.impl").then((m) => m.pythonImpl),
};
