import type { EditorDescriptor } from "../core/types";

// Raster image editor (crop / rotate / flip / resize / filters / annotate) via Filerobot Image
// Editor. Opt-in: images open in the read-only image viewer by default and this editor is offered
// as an alternative in the View switcher, so its heavy chunk loads only when you choose to edit.
export const filerobotEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "imageedit", consumesViews: ["image"] },
  load: () => import("./filerobot.impl").then((m) => m.filerobotEditor),
};
