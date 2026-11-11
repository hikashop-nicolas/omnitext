import type { EditorDescriptor } from "../core/types";

// Music scores (MusicXML, mxl, MuseScore) in the scoredit viewer. Read-only until scoredit's note entry lands.
export const scoreEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "score", consumesViews: ["score"], readOnly: true },
  load: () => import("./score.impl").then((m) => m.scoreEditor),
};
