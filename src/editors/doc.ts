import type { EditorDescriptor } from "../core/types";

// Legacy Word 97-2003 (.doc) editor, via richdoc's from-scratch .doc read/write.
export const docEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "doc", consumesViews: ["doc"] },
  load: () => import("./doc.impl").then((m) => m.docEditor),
};
