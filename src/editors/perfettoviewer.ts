import type { EditorDescriptor } from "../core/types";

// Read-only Perfetto trace summary: packets, processes, kernel events, logcat, slices.
export const perfettoViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "perfettoviewer", consumesViews: ["perfetto"], readOnly: true, unprintable: true },
  load: () => import("./perfettoviewer.impl").then((m) => m.perfettoViewer),
};
