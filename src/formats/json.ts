import type { FormatDescriptor } from "../core/types";
import { isBracketedValue } from "./bracket-value";

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
    return isBracketedValue(sample) ? 0.6 : 0;
  },
  load: () => import("./json.impl").then((m) => m.jsonImpl),
};
