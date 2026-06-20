import type { FormatDescriptor } from "../core/types";

export const shellFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "shell",
    extensions: [".sh", ".bash", ".zsh"],
    mimeTypes: ["application/x-sh"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /^#!.*\b(sh|bash|zsh)\b/.test(sample) ? 0.6 : 0;
  },
  load: () => import("./shell.impl").then((m) => m.shellImpl),
};
