import type { EditorModule } from "../core/types";
import { TraceViewInstance } from "./traceview-host";

// Read-only profile viewer (flame graph, call tree, functions) for every profile format, via traceview.
export const profileViewer: EditorModule = {
  create: () => new TraceViewInstance("profile"),
};
