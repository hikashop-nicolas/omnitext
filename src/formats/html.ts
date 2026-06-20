import type { FormatDescriptor } from "../core/types";

export const htmlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "html",
    extensions: [".html", ".htm"],
    mimeTypes: ["text/html"],
    nativeEditor: "codemirror",
    viewAdapters: ["richtext", "preview"],
    defaultEditor: "quill",
  },
  detect({ sample }) {
    return /^\s*<(!doctype|html|head|body|div|p|span|a|h[1-6]|ul|table)\b/i.test(sample)
      ? 0.55
      : 0;
  },
  load: () => import("./html.impl").then((m) => m.htmlImpl),
};
