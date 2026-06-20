import type { FormatDescriptor } from "../core/types";

export const iniFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ini",
    extensions: [".ini", ".cfg", ".conf"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /^\s*\[[^\]]+\]\s*$/m.test(sample) || /^\s*[\w.-]+\s*=/m.test(sample) ? 0.15 : 0;
  },
  load: () => import("./ini.impl").then((m) => m.iniImpl),
};
