import type { FormatDescriptor } from "../core/types";

// Lightweight descriptor (eagerly registered). The parser + CodeMirror language load
// on demand from ./json.impl when a JSON document is actually opened.
export const jsonFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "json",
    extensions: [".json"],
    mimeTypes: ["application/json"],
    nativeEditor: "codemirror",
    viewAdapters: ["tree"],
    defaultEditor: "tree",
  },
  detect({ sample }) {
    const s = sample.trimStart();
    return s.startsWith("{") || s.startsWith("[") ? 0.6 : 0;
  },
  load: () => import("./json.impl").then((m) => m.jsonImpl),
};
