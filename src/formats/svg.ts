import type { FormatDescriptor } from "../core/types";

// SVG: a text format. Default editor is the svgedit vector canvas (WYSIWYG); the raw XML
// is available via the CodeMirror text view. getText round-trips the serialized SVG.
export const svgFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "svg",
    extensions: [".svg"],
    mimeTypes: ["image/svg+xml"],
    nativeEditor: "svgeditor",
    defaultEditor: "svgeditor",
  },
  detect() {
    return 0;
  },
  load: () => import("./svg.impl").then((m) => m.svgImpl),
};
