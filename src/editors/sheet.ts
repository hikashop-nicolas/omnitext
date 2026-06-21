import type { EditorDescriptor } from "../core/types";

export const sheetEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "sheet", consumesViews: ["sheet"] },
  load: () => import("./sheet.impl").then((m) => m.sheetEditor),
};
