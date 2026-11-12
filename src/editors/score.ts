import type { EditorDescriptor } from "../core/types";

// Music scores (MusicXML, mxl, MuseScore) in the scoredit viewer and editor. Edited scores
// save like any document (Save, the unsaved dot, autosave); MuseScore 2 files stay unedited.
export const scoreEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "score", consumesViews: ["score"] },
  load: () => import("./score.impl").then((m) => m.scoreEditor),
};
