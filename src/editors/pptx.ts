import type { EditorDescriptor } from "../core/types";

export const pptxEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "pptx", consumesViews: ["pptx"], readOnly: true },
  load: () => import("./pptx.impl").then((m) => m.pptxEditor),
};
