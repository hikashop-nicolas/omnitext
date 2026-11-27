import type { FormatDescriptor } from "../core/types";
import { looksLikeChromeTrace } from "./trace-detect";

// Chrome / Catapult JSON traces: JSON text that opens in the trace viewer when its content says
// it is a trace (a traceEvents array, or an array of events); other JSON keeps the JSON editors.
export const chromeTraceFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "chrometrace",
    extensions: [],
    nativeEditor: "traceviewer",
    defaultEditor: "traceviewer",
  },
  detect: ({ sample }) => (looksLikeChromeTrace(sample) ? 0.9 : 0),
  load: () => import("./trace-text.impl").then((m) => m.traceTextImpl),
};
