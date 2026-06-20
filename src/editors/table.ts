import type { EditorDescriptor } from "../core/types";

export const tableEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "table", consumesViews: ["table"] },
  load: () => import("./table.impl").then((m) => m.tableEditor),
};
