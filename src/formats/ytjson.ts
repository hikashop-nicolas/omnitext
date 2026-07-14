import type { FormatDescriptor } from "../core/types";

// YouTube JSON captions (.srv3/.json3). Opens in the subedit cue editor. The content sniff is
// modest so ordinary .json keeps the JSON editor; .srv3/.json3 route here by extension.
export const ytjsonFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ytjson",
    extensions: [".srv3", ".json3"],
    mimeTypes: ["application/json"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
    blankInDefaultEditor: true,
  },
  detect({ sample }) {
    return /"events"[\s\S]*"tStartMs"/.test(sample) ? 0.6 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
