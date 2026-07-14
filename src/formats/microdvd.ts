import type { FormatDescriptor } from "../core/types";

// MicroDVD (.sub): frame-based "{start}{end}text" subtitles. Default surface is the subedit
// cue editor; the raw text stays available via the CodeMirror text view. Model === text.
export const microdvdFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "microdvd",
    extensions: [".sub"],
    mimeTypes: ["text/x-microdvd"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  // Lines of the form "{123}{456}text" mark MicroDVD (disambiguates .sub from binary VobSub).
  detect({ sample }) {
    return /^\{\d+\}\{\d+\}/m.test(sample) ? 0.8 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
