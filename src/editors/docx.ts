import type { EditorDescriptor } from "../core/types";

export const docxEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "docx", consumesViews: ["docx"] },
  load: () => import("./docx.impl").then((m) => m.docxEditor),
};
