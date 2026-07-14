import type { FormatDescriptor } from "../core/types";

// Spruce STL (.stl, the text subtitle variant). The .stl extension is shared with 3D STL
// models, so the content sniff scores above the extension prior only for real timecode
// subtitle lines, letting a Spruce subtitle open in subedit while 3D .stl stays the model viewer.
export const spruceFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "spruce",
    extensions: [".stl"],
    mimeTypes: ["text/x-spruce"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
  },
  detect({ sample }) {
    return /^\d{2}:\d{2}:\d{2}:\d{2},\d{2}:\d{2}:\d{2}:\d{2},/m.test(sample) ? 0.97 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
