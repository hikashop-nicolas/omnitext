import type { FormatDescriptor } from "../core/types";
import { ctraceStart, isFxt, logcatFormat, looksLikeNinjaLog, looksLikeStrace } from "./trace-detect";

// More trace formats for the trace viewer: text ones claimed by their content (strictly, so
// other .txt and .log files stay text), binary ones by their magic, archives of traces by main.

const text = (id: string, extensions: string[], detect: (sample: string) => boolean): FormatDescriptor => ({
  manifest: { kind: "format", id, extensions, nativeEditor: "traceviewer", defaultEditor: "traceviewer" },
  detect: ({ sample }) => (detect(sample) ? 0.97 : 0),
  load: () => import("./trace-text.impl").then((m) => m.traceTextImpl),
});

const binary = (id: string, extensions: string[], sniff: (head: Uint8Array) => boolean, extra: Partial<FormatDescriptor["manifest"]> = {}): FormatDescriptor => ({
  manifest: { kind: "format", id, extensions, binary: true, nativeEditor: "traceviewer", defaultEditor: "traceviewer", soleEditor: true, ...extra },
  detect: () => 0,
  sniffBytes: sniff,
  load: () => import("./perfetto.impl").then((m) => m.perfettoImpl),
});

export const ninjaLogFormat = text("ninjalog", [".ninja_log"], looksLikeNinjaLog);
export const straceFormat = text("strace", [".strace"], looksLikeStrace);
export const logcatTextFormat = text("logcat", [".logcat"], (s) => logcatFormat(s) !== null);
// Compressed systrace (atrace -z): "TRACE:" then a zlib stream.
export const ctraceFormat = binary("ctrace", [".ctrace"], (h) => ctraceStart(h) >= 0);
export const fuchsiaTraceFormat = binary("fuchsia", [".fxt"], isFxt);
// A zip or tar of traces, opened on one timeline; the archive list stays one switch away.
export const traceArchiveFormat = binary("tracearchive", [], () => false, { viewAdapters: ["archive"], soleEditor: false });

export const traceFormats = [ninjaLogFormat, straceFormat, logcatTextFormat, ctraceFormat, fuchsiaTraceFormat, traceArchiveFormat];
