import type { FormatDescriptor } from "../core/types";

export const cssFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "css",
    extensions: [".css"],
    mimeTypes: ["text/css"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /[.#]?[\w-]+\s*\{[^}]*\}/.test(sample) ? 0.3 : 0;
  },
  load: () => import("./css.impl").then((m) => m.cssImpl),
};
