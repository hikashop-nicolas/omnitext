import type { EditorDescriptor } from "../core/types";

// Music scores (MusicXML, mxl, MuseScore, Guitar Pro 7, MIDI) in the scoredit viewer and editor.
// Edited scores save like any document; MuseScore 2, ABC and Guitar Pro 3 to 6 files are view-only.
export const scoreEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "score", consumesViews: ["score"] },
  load: () => import("./score.impl").then((m) => m.scoreEditor),
};
