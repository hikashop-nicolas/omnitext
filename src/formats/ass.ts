import type { FormatDescriptor } from "../core/types";

// Advanced SubStation Alpha (.ass): styled subtitles (fonts, positioning, karaoke).
// Default surface is the subedit cue editor, which keeps the [V4+ Styles] section and
// exposes a style picker; the raw text stays available via CodeMirror. Model === text.
export const assFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ass",
    extensions: [".ass"],
    mimeTypes: ["text/x-ass"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
  },
  // The "[Script Info]" header plus the "[V4+ Styles]" section mark ASS (v4+).
  detect({ sample }) {
    return /\[Script Info\]/i.test(sample) && /\[V4\+ Styles\]/i.test(sample) ? 0.9 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
