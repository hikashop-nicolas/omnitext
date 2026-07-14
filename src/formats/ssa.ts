import type { FormatDescriptor } from "../core/types";

// SubStation Alpha (.ssa): the v4 predecessor of ASS. Same subedit cue editor; the raw
// text stays available via the CodeMirror text view. Model === text.
export const ssaFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ssa",
    extensions: [".ssa"],
    mimeTypes: ["text/x-ssa"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
  },
  // "[Script Info]" with a "[V4 Styles]" section (no plus) marks classic SSA v4.
  detect({ sample }) {
    return /\[Script Info\]/i.test(sample) && /\[V4 Styles\]/i.test(sample) ? 0.9 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
