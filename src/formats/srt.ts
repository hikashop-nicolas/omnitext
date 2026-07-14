import type { FormatDescriptor } from "../core/types";

// SubRip (.srt): the most common subtitle format. Default surface is the subedit cue
// editor; the raw text stays available via the CodeMirror text view. Model === text.
export const srtFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "srt",
    extensions: [".srt"],
    mimeTypes: ["application/x-subrip", "text/srt"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
  },
  // A digit index line, then a "HH:MM:SS,mmm --> HH:MM:SS,mmm" cue timing line.
  detect({ sample }) {
    return /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(sample) ? 0.8 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
