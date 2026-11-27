import type { FormatDescriptor } from "../core/types";
import { looksLikeSystrace } from "traceview";

// Android systrace / ftrace text ("# tracer: nop"), bare or inside systrace's HTML page.
export const systraceFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "systrace",
    extensions: [".systrace", ".atrace"],
    nativeEditor: "traceviewer",
    defaultEditor: "traceviewer",
  },
  detect: ({ sample }) => (looksLikeSystrace(sample) ? 0.97 : 0),
  load: () => import("./trace-text.impl").then((m) => m.traceTextImpl),
};
