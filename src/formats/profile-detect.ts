// Content checks for text CPU profiles, kept small and strict: they run on every text file
// opened, and JSON or text that is not a profile must keep its own editor.

const COLLAPSED = /^\S.*\s\d+(?:\.\d+)?$/;

/** Brendan Gregg's collapsed stacks: every line "frame;frame;... count" (comments allowed). */
export function looksLikeCollapsed(sample: string): boolean {
  const lines = sample.split("\n");
  // The sample may end mid-line.
  if (lines.length > 1 && !sample.endsWith("\n")) lines.pop();
  let valid = 0;
  let stacked = 0;
  let invalid = 0;
  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.trim() || line.startsWith("#") || line.startsWith("//")) continue;
    if (COLLAPSED.test(line) && !/\t/.test(line)) {
      valid++;
      if (line.includes(";")) stacked++;
    } else invalid++;
  }
  // A stray line is tolerated in a run of valid ones, never in a short file.
  return valid >= 2 && stacked >= 1 && stacked * 2 >= valid && invalid * 5 <= valid;
}

// A sample header names its time, or at least its pid (old perf versions print no time).
const PERF_HEAD = /^\S.*?\s+(?:\d+(?:\/\d+)?\s+)?(?:\[\d+\]\s+)?\d+\.\d+:\s+(?:\d+\s+)?\S+:/;
const PERF_HEAD_PID = /^\S.*?\s+\d+(?:\/\d+)?\s+(?:\[\d+\]\s+)?(?:\d+\s+)?[A-Za-z][\w/.:-]*?:(?:\s|$)/;
const PERF_FRAME = /^\s+[0-9a-fA-F]+\s+\S.*$/;

/** `perf script` or `simpleperf report-sample` output: sample headers, frames indented under them. */
export function looksLikePerfScript(sample: string): boolean {
  const lines = sample.split("\n").slice(0, 400);
  if (lines.length > 1 && !sample.endsWith("\n")) lines.pop();
  let heads = 0;
  let timed = 0;
  let framed = 0;
  let other = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    const withTime = PERF_HEAD.test(line);
    if (withTime || PERF_HEAD_PID.test(line)) {
      heads++;
      if (withTime) timed++;
      if (PERF_FRAME.test(lines[i + 1] ?? "")) framed++;
    } else if (!PERF_FRAME.test(line)) other++;
  }
  if (other > heads / 10) return false;
  // Callchains: frames under the headers; without them, one timed header per line.
  return heads >= 1 && (framed >= Math.min(2, heads) || timed >= 3);
}

/** A Firefox Profiler (Gecko) profile: its meta block, from Firefox, samply or the profiler. */
export function looksLikeGeckoProfile(sample: string): boolean {
  if (!/^\s*\{/.test(sample)) return false;
  // Firefox's old DevTools recordings wrap one.
  if (/^\s*\{\s*"label"\s*:[\s\S]{0,4000}?"profile"\s*:\s*\{\s*"libs"\s*:/.test(sample)) return true;
  if (!/"meta"\s*:\s*\{/.test(sample) || /"traceEvents"\s*:/.test(sample.slice(0, 4000))) return false;
  return /"interval"\s*:/.test(sample) && /"startTime"\s*:/.test(sample) && /"(?:preprocessedProfileVersion|stackwalk|processType|product|abi)"\s*:/.test(sample);
}

/** A Chrome / Node .cpuprofile: a node tree with call frames. */
export function looksLikeCpuProfile(sample: string): boolean {
  if (!/^\s*\{/.test(sample) || /"traceEvents"\s*:/.test(sample.slice(0, 4000))) return false;
  if (/^\s*\{\s*"head"\s*:\s*\{\s*"functionName"\s*:/.test(sample)) return true;
  return /"nodes"\s*:\s*\[\s*\{/.test(sample) && /"callFrame"\s*:\s*\{/.test(sample) && /"functionName"\s*:/.test(sample);
}

/** A speedscope file, by its schema URL or its shape (shared frames and typed profiles). */
export function looksLikeSpeedscope(sample: string): boolean {
  if (!/^\s*\{/.test(sample)) return false;
  if (/"\$schema"\s*:\s*"https:\/\/www\.speedscope\.app\/file-format-schema\.json"/.test(sample)) return true;
  return /"shared"\s*:\s*\{\s*"frames"\s*:/.test(sample) && /"profiles"\s*:\s*\[/.test(sample) && /"type"\s*:\s*"(?:evented|sampled)"/.test(sample);
}

export type ProfileKind = "collapsed" | "perfscript" | "gecko" | "cpuprofile" | "chrometrace" | "speedscope" | "pprof" | "simpleperf";

/** Which reader a text profile needs, by its content. */
export function textProfileKind(sample: string): ProfileKind | null {
  const head = sample.slice(0, 8192);
  if (looksLikeSpeedscope(head)) return "speedscope";
  if (looksLikeCpuProfile(head)) return "cpuprofile";
  if (looksLikeGeckoProfile(head)) return "gecko";
  if (/^\s*[[{]/.test(head)) return "chrometrace";
  if (looksLikePerfScript(head)) return "perfscript";
  if (looksLikeCollapsed(head)) return "collapsed";
  return null;
}
