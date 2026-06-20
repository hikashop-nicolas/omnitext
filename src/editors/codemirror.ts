import type { EditorDescriptor } from "../core/types";

// Lightweight descriptor (eagerly registered). CodeMirror itself loads on demand from
// ./codemirror.impl when an editor is first mounted.
export const codemirrorEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "codemirror", consumesViews: ["text"] },
  load: () => import("./codemirror.impl").then((m) => m.codemirrorEditor),
};
