import type { EditorDescriptor } from "../core/types";

export const imageEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "image", consumesViews: ["image"], readOnly: true },
  load: () => import("./image.impl").then((m) => m.imageEditor),
};
