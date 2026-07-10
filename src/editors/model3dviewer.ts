import type { EditorDescriptor } from "../core/types";

// Read-only 3D model viewer (three.js): STL/PLY/OBJ/glTF/GLB in a WebGL scene with
// orbit controls. Rendering only, not an editor.
export const model3dViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "model3dviewer", consumesViews: ["model3d"], readOnly: true },
  load: () => import("./model3dviewer.impl").then((m) => m.model3dViewer),
};
