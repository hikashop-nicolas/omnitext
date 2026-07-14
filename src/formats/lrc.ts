import type { FormatDescriptor } from "../core/types";

// LRC timed lyrics: "[mm:ss.xx]text" lines. Default surface is the subedit cue editor; the
// raw text stays available via the CodeMirror text view. Model === text.
export const lrcFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "lrc",
    extensions: [".lrc"],
    mimeTypes: ["application/x-lrc", "text/x-lrc"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  // A "[mm:ss.xx]" timestamp tag at the start of a line marks LRC.
  detect({ sample }) {
    return /^(?:\[[a-z#]+:[^\]]*\]\s*)*\[\d{1,2}:\d{2}[.:]/im.test(sample) ? 0.8 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
