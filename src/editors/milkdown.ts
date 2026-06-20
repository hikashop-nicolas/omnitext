import type { EditorDescriptor } from "../core/types";

export const milkdownEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "milkdown", consumesViews: ["markdown"] },
  load: () => import("./milkdown.impl").then((m) => m.milkdownEditor),
};
