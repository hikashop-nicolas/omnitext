import type { EditorDescriptor } from "../core/types";

export const epubEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "epub", consumesViews: ["epub"], readOnly: true },
  load: () => import("./epub.impl").then((m) => m.epubEditor),
};
