import type { FormatDescriptor } from "../core/types";

// MusicXML: XML text whose default surface is the scoredit score viewer; the raw XML stays
// available in the text view. A plain .xml holding a score is recognised by its root.
export const musicxmlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "musicxml",
    extensions: [".musicxml"],
    mimeTypes: ["application/vnd.recordare.musicxml+xml"],
    nativeEditor: "score",
    defaultEditor: "score",
  },
  detect({ sample }) {
    return /<score-(partwise|timewise)[\s>]/.test(sample) ? 0.9 : 0;
  },
  load: () => import("./musicxml.impl").then((m) => m.musicxmlImpl),
};

// Compressed MusicXML (a zip): only the score viewer can show it.
export const mxlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "mxl",
    extensions: [".mxl"],
    mimeTypes: ["application/vnd.recordare.musicxml"],
    binary: true,
    nativeEditor: "score",
    defaultEditor: "score",
    soleEditor: true,
  },
  detect: () => 0, // a zip; routed by extension
  load: () => import("./musicxml.impl").then((m) => m.mxlImpl),
};
