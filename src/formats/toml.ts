import type { FormatDescriptor } from "../core/types";

export const tomlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "toml",
    extensions: [".toml"],
    mimeTypes: ["application/toml"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /^\s*\[[^\]]+\]\s*$/m.test(sample) || /^\s*[\w."'-]+\s*=/m.test(sample) ? 0.25 : 0;
  },
  load: () => import("./toml.impl").then((m) => m.tomlImpl),
};
