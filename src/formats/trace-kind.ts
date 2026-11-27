import { gunzipSync } from "fflate";
import { looksLikePerfetto } from "../core/sniff";
import { ctraceStart, isFxt, logcatFormat, looksLikeChromeTrace, looksLikeNinjaLog, looksLikeStrace, looksLikeSystrace } from "./trace-detect";

// Which trace reader a file needs, from its content: shared by the trace viewer and the check
// that tells an archive of traces from any other archive.

export type TraceKind = "perfetto" | "json" | "systrace" | "ctrace" | "ninja" | "strace" | "logcat" | "fuchsia" | "archive";

/** The kind of a text trace, or null when the text is none of them. */
export function textKind(text: string): TraceKind | null {
  const head = text.slice(0, 8192);
  if (looksLikeNinjaLog(head)) return "ninja";
  if (looksLikeChromeTrace(head)) return "json";
  if (looksLikeSystrace(head)) return "systrace";
  if (logcatFormat(head)) return "logcat";
  if (looksLikeStrace(head)) return "strace";
  return null;
}

/** The kind of a binary trace, from its first bytes, or null. */
export function bytesKind(b: Uint8Array, whole = false): TraceKind | null {
  if (isFxt(b)) return "fuchsia";
  if (ctraceStart(b) >= 0) return "ctrace";
  if (looksLikePerfetto(b.subarray(0, 2 << 20), whole || b.length <= 2 << 20)) return "perfetto";
  return null;
}

/** An archive entry's kind (null: not a trace) and bytes, gunzipped for a .gz entry. */
export function entryKind(name: string, data: Uint8Array, whole = true): { kind: TraceKind | null; data: Uint8Array } {
  if (/\.gz$/i.test(name) && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = gunzipSync(data);
    } catch {
      return { kind: null, data };
    }
  }
  const bin = bytesKind(data, whole);
  if (bin) return { kind: bin, data };
  const head = new TextDecoder().decode(data.subarray(0, 8192));
  if (head.includes("\u0000")) return { kind: null, data };
  return { kind: textKind(head), data };
}
