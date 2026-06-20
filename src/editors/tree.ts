import type { EditorDescriptor } from "../core/types";

export const treeEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "tree", consumesViews: ["tree"] },
  load: () => import("./tree.impl").then((m) => m.treeEditor),
};
