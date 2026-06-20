import type { FormatDescriptor } from "../core/types";

export const dotenvFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "dotenv",
    extensions: [".env"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /^\s*[A-Z_][A-Z0-9_]*\s*=/m.test(sample) ? 0.2 : 0;
  },
  load: () => import("./properties.impl").then((m) => m.propertiesImpl),
};
