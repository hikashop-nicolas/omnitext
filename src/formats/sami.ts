import type { FormatDescriptor } from "../core/types";

// SAMI (.smi): Microsoft's HTML-ish caption format. Opens in the subedit cue editor.
export const samiFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "sami",
    extensions: [".smi", ".sami"],
    mimeTypes: ["application/smil+xml"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  detect({ sample }) {
    return /<sami[\s>]/i.test(sample) ? 0.85 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
