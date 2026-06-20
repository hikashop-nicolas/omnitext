import type { FormatDescriptor } from "../core/types";

export const json5Format: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "json5",
    extensions: [".json5"],
    mimeTypes: ["application/json5"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    const s = sample.trimStart();
    // Lower than strict JSON, so a plain .json with no comments prefers json.
    return s.startsWith("{") || s.startsWith("[") ? 0.3 : 0;
  },
  load: () => import("./json5.impl").then((m) => m.json5Impl),
};
