import type { EditorDescriptor } from "../core/types";

// Read-only CPU profile viewer (pprof, perf, Firefox, V8, speedscope, simpleperf, collapsed stacks):
// flame graph, call tree and functions. Also offered for Chrome traces that hold CPU samples.
export const profileViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "profileviewer", consumesViews: ["profile"], readOnly: true, unprintable: true },
  load: () => import("./profileviewer.impl").then((m) => m.profileViewer),
};
