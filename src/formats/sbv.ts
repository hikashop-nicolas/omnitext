import type { FormatDescriptor } from "../core/types";

// SBV (YouTube SubViewer): "H:MM:SS.mmm,H:MM:SS.mmm" cues. Opens in the subedit cue editor.
export const sbvFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "sbv",
    extensions: [".sbv"],
    mimeTypes: ["text/x-subviewer"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  detect({ sample }) {
    return /^\d{1,2}:\d{2}:\d{2}[.,]\d{3},\d{1,2}:\d{2}:\d{2}[.,]\d{3}/m.test(sample) ? 0.8 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
