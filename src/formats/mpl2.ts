import type { FormatDescriptor } from "../core/types";

// MPL2 (.mpl): "[start][end]text" in deciseconds. Opens in the subedit cue editor.
export const mpl2Format: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "mpl2",
    extensions: [".mpl"],
    mimeTypes: ["text/x-mpl2"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  detect({ sample }) {
    return /^\[\d+\]\[\d+\]/m.test(sample) ? 0.8 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
