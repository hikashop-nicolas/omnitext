import type { EditorDescriptor } from "../core/types";

// Read-only grid viewer for Arrow IPC/Feather and Avro container files.
export const recordsViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "recordsviewer", consumesViews: ["records"], readOnly: true },
  load: () => import("./recordsviewer.impl").then((m) => m.recordsViewer),
};
