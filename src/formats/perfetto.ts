import type { FormatDescriptor } from "../core/types";

// Perfetto traces (.pftrace, .perfetto-trace), as Android's System Tracing records them: a
// protobuf stream of trace packets, summarised read-only by the Perfetto trace viewer.
export const perfettoFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "perfetto",
    extensions: [".pftrace", ".perfetto-trace", ".perfetto"],
    binary: true,
    nativeEditor: "perfettoviewer",
    defaultEditor: "perfettoviewer",
    soleEditor: true,
  },
  detect: () => 0,
  load: () => import("./perfetto.impl").then((m) => m.perfettoImpl),
};
