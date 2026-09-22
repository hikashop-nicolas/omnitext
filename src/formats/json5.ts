import type { FormatDescriptor } from "../core/types";
import { isBracketedValue } from "./bracket-value";

export const json5Format: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "json5",
    extensions: [".json5"],
    mimeTypes: ["application/json5"],
    nativeEditor: "codemirror",
    viewAdapters: ["tree"],
    defaultEditor: "tree",
  },
  detect({ sample }) {
    // Lower than strict JSON, so a plain .json with no comments prefers json. JSON5 strings
    // may use single quotes.
    return isBracketedValue(sample, "\"'") ? 0.3 : 0;
  },
  load: () => import("./json5.impl").then((m) => m.json5Impl),
};
