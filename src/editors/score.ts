import type { EditorDescriptor } from "../core/types";

// Music scores (MusicXML, mxl, MuseScore) in the scoredit viewer and editor. Edited scores
// save like any document; MuseScore 2, ABC, Guitar Pro and MIDI files are view-only.
export const scoreEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "score", consumesViews: ["score"] },
  load: () => import("./score.impl").then((m) => m.scoreEditor),
};
