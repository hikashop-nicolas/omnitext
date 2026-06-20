import type { EditorDescriptor } from "../core/types";

export const quillEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "quill", consumesViews: ["richtext"] },
  load: () => import("./quill.impl").then((m) => m.quillEditor),
};
