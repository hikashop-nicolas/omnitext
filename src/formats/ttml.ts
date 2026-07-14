import type { FormatDescriptor } from "../core/types";

// TTML / DFXP: the timed-text caption XML used by broadcast and streaming. Default surface is
// the subedit cue editor; the raw XML stays available via the CodeMirror text view. The
// content sniff targets the TTML namespace so ordinary XML keeps its own editor.
export const ttmlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ttml",
    extensions: [".ttml", ".dfxp"],
    mimeTypes: ["application/ttml+xml"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  // A <tt> root using the TTML namespace (so a plain .xml that is TTML routes here, not XML).
  detect({ sample }) {
    return /<tt[\s>][\s\S]*ttml/i.test(sample) ? 0.85 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
