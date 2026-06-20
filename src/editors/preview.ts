import type { EditorDescriptor } from "../core/types";

export const previewEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "preview", consumesViews: ["preview"] },
  load: () => import("./preview.impl").then((m) => m.previewEditor),
};
