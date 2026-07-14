import type { FormatDescriptor } from "../core/types";

// TTXT (3GPP / MPEG-4 Timed Text): an XML <TextStream> of timed <TextSample> markers. Opens
// in the subedit cue editor; the raw XML stays available via the CodeMirror text view.
export const ttxtSubFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ttxt",
    extensions: [".ttxt"],
    mimeTypes: ["application/ttxt+xml"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  detect({ sample }) {
    return /<TextStream[\s>]|<TextSample\b/i.test(sample) ? 0.85 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
