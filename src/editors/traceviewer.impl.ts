import type { EditorModule } from "../core/types";
import { TraceViewInstance } from "./traceview-host";

// Read-only trace viewer for Perfetto, Chrome JSON, systrace, ftrace, Fuchsia, ninja, strace,
// logcat and archives of them, via traceview.
export const traceViewer: EditorModule = {
  create: () => new TraceViewInstance("trace"),
};
