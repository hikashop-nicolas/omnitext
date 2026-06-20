import type { FormatDescriptor } from "../core/types";

export const propertiesFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "properties",
    extensions: [".properties"],
    mimeTypes: ["text/x-java-properties"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /^\s*[\w.-]+\s*[=:]/m.test(sample) ? 0.12 : 0;
  },
  load: () => import("./properties.impl").then((m) => m.propertiesImpl),
};
