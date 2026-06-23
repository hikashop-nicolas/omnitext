import type { EditorDescriptor } from "../core/types";

export const svgEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "svgeditor", consumesViews: ["svg"] },
  load: () => import("./svgeditor.impl").then((m) => m.svgEditor),
};
