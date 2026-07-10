import type { FormatDescriptor } from "../core/types";

// Legacy Word 97-2003 binary documents (.doc): edited in place via richdoc's .doc adapter
// (reads the OLE binary to HTML; regenerates a valid .doc on save). Detected by extension
// (the OLE magic is shared with .xls/.msg, which route by extension too).
export const docFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "doc",
    extensions: [".doc"],
    mimeTypes: ["application/msword"],
    binary: true,
    viewAdapters: ["doc"],
    defaultEditor: "doc",
  },
  detect: () => 0,
  load: () => import("./doc.impl").then((m) => m.docImpl),
};
