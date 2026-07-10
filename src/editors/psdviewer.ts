import type { EditorDescriptor } from "../core/types";

// Read-only Photoshop (.psd/.psb) viewer: renders the flattened composite image and
// lists the layer tree. Editing is out of scope.
export const psdViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "psdviewer", consumesViews: ["psd"], readOnly: true },
  load: () => import("./psdviewer.impl").then((m) => m.psdViewer),
};
