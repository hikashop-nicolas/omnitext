import type { FormatDescriptor } from "../core/types";

export const yamlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "yaml",
    extensions: [".yaml", ".yml"],
    mimeTypes: ["application/yaml", "text/yaml"],
    nativeEditor: "codemirror",
    viewAdapters: ["tree"],
    defaultEditor: "tree",
  },
  detect({ sample }) {
    if (sample.startsWith("---") || /^[\w-]+:\s/m.test(sample)) return 0.25;
    return 0;
  },
  load: () => import("./yaml.impl").then((m) => m.yamlImpl),
};
