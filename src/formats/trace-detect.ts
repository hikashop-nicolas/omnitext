// Content checks for text traces, kept small: they run on every text file opened.

/** Whether a text sample clearly is a Chrome / Catapult JSON trace rather than other JSON. */
export function looksLikeChromeTrace(sample: string): boolean {
  if (/^\s*\{[\s\S]{0,4000}?"traceEvents"\s*:\s*\[/.test(sample)) return true;
  return /^\s*\[\s*\{/.test(sample) && /"ph"\s*:\s*"[A-Za-z]"/.test(sample) && /"ts"\s*:/.test(sample) && /"pid"\s*:/.test(sample);
}

/** Whether a text sample is a systrace / ftrace text dump or a systrace HTML page. */
export function looksLikeSystrace(sample: string): boolean {
  if (/^(?:TRACE:\s*)?# tracer: /m.test(sample.slice(0, 2000))) return true;
  // trace-cmd report: "cpus=N" then event lines.
  if (/^(?:version = \d+\r?\n)?cpus=\d+\r?\n\s*\S+-\d+\s+(?:\(\s*(?:\d+|-+)\)\s+)?\[\d+\]\s+(?:[\w.]{4,5}\s+)?\d+\.\d+: /.test(sample)) return true;
  return /<script[^>]*class="trace-data"/.test(sample) || /<title>[^<]*(?:Android System Trace|systrace)[^<]*<\/title>/i.test(sample);
}

/** A Fuchsia trace (FXT): its magic number record. */
export const isFxt = (b: Uint8Array): boolean =>
  b.length >= 8 && b[0] === 0x10 && b[1] === 0 && b[2] === 4 && b[3] === 0x46 && b[4] === 0x78 && b[5] === 0x54 && b[6] === 0x16 && b[7] === 0;

/** Offset of the zlib stream of a compressed systrace (after its "TRACE:" line), or -1. */
export function ctraceStart(b: Uint8Array): number {
  const head = String.fromCharCode(...b.subarray(0, Math.min(b.length, 512)));
  const at = head.indexOf("TRACE:\n");
  if (at < 0) return -1;
  const z = at + 7;
  // A zlib header: CMF 0x78, and CMF * 256 + FLG a multiple of 31.
  return b[z] === 0x78 && ((b[z]! << 8) | b[z + 1]!) % 31 === 0 ? z : -1;
}

/** A ninja build log: "# ninja log v5" (to v7) on its first line. */
export function looksLikeNinjaLog(sample: string): boolean {
  return /^# ninja log v\d+\r?\n/.test(sample);
}

/** The first lines that say something, without the last one (a sample can cut it off). */
function headLines(sample: string, max: number, skip: RegExp): string[] {
  const lines = sample.split("\n");
  if (lines.length > 1) lines.pop();
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.replace(/\r+$/, "");
    if (!l.trim() || skip.test(l)) continue;
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

// strace: optional pid ("123 " or "[pid 123] "), optional time (-t, -tt, -ttt), then a call, a
// resumed call, a signal or an exit.
export const STRACE_LINE = /^(?:\[pid\s+(\d+)\]\s+|(\d+)\s+)?(?:(\d\d):(\d\d):(\d\d)(\.\d+)?\s+|(\d+)(\.\d+)\s+)?(.*)$/;
const STRACE_BODY = /^(?:[a-z_][a-z0-9_]*\(.*(?:\)\s+=\s+(?:-?\d|0x|\?)|<unfinished \.\.\.>$)|<\.\.\. [a-z_][a-z0-9_]* resumed>|--- SIG[A-Z0-9]+ |\+\+\+ (?:exited|killed) )/;

/** Whether a text sample is strace output: most of its first lines are system calls. */
export function looksLikeStrace(sample: string): boolean {
  const lines = headLines(sample, 30, /^strace: /);
  if (lines.length < 3) return false;
  let hits = 0;
  for (const l of lines) {
    const m = STRACE_LINE.exec(l);
    if (m && STRACE_BODY.test(m[9]!)) hits++;
  }
  return hits >= 3 && hits >= lines.length * 0.7;
}

// adb logcat formats: threadtime ("-v threadtime", the default, with or without a year or uid
// column), time ("D/Tag( 123): msg" after the date) and brief (no date).
export const LOGCAT_THREADTIME = /^(?:(\d{4})-)?(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3,9})\s+(?:\S+\s+)??(\d+)\s+(\d+) ([VDIWEFAS]) (.*?)\s*:(?: (.*))?$/;
export const LOGCAT_TIME = /^(?:(\d{4})-)?(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3,9})\s+([VDIWEFAS])\/(.*?)\(\s*(\d+)\): ?(.*)$/;
export const LOGCAT_BRIEF = /^([VDIWEFAS])\/(.*?)\(\s*(\d+)\): ?(.*)$/;

/** Which logcat format a sample is in, when nearly all of its first lines are in that one. */
export function logcatFormat(sample: string): "threadtime" | "time" | "brief" | null {
  const lines = headLines(sample, 40, /^--------- /);
  if (lines.length < 3) return null;
  for (const [name, re] of [["threadtime", LOGCAT_THREADTIME], ["time", LOGCAT_TIME], ["brief", LOGCAT_BRIEF]] as const) {
    let hits = 0;
    for (const l of lines) if (re.test(l)) hits++;
    if (hits >= lines.length * 0.8) return name;
  }
  return null;
}
