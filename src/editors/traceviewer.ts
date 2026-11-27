import type { EditorDescriptor } from "../core/types";

// Read-only trace viewer (Perfetto, Chrome JSON, systrace): timeline, processes, kernel events, logcat.
export const traceViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "traceviewer", consumesViews: ["perfetto", "chrometrace", "systrace"], readOnly: true, unprintable: true },
  load: () => import("./traceviewer.impl").then((m) => m.traceViewer),
};
