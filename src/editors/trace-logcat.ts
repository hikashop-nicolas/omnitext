import { LOGCAT_BRIEF, LOGCAT_THREADTIME, LOGCAT_TIME, logcatFormat } from "../formats/trace-detect";
import { LOG_CAP, type TraceSummary } from "./perfetto-parse";
import type { ModelBuilder } from "./trace-model";
import type { TraceStats } from "./trace-stats";

// Android logcat text (adb logcat -v threadtime, also -v time and -v brief): the lines fill the
// Logcat table and show as instants on their thread's row. Times are wall-clock as printed.

const PRIO: Record<string, number> = { V: 2, D: 3, I: 4, W: 5, E: 6, F: 7, A: 7, S: 1 };
const LEVELS = ["", "", "V", "D", "I", "W", "E", "F"];

/** A wall-clock time as printed (read as UTC, so no time zone moves it) matched to a trace time. */
export interface LogcatAlign {
  wallMs: number;
  ts: number;
}

export interface LogcatResult {
  stats: TraceStats;
  /** First line's wall-clock time in local ms, for the Overview's start. */
  wallStartMs: number | null;
  lines: number;
}

/** Wall-clock ms as printed (as if UTC) of a logcat text's dated lines, up to `cap` of them. */
export function logcatWallTimes(text: string, cap = 20000, year = new Date().getFullYear()): number[] {
  const out: number[] = [];
  for (const l of text.split("\n")) {
    const line = l.replace(/\r+$/, "");
    const m = LOGCAT_THREADTIME.exec(line) ?? LOGCAT_TIME.exec(line);
    if (m) out.push(Date.UTC(m[1] ? Number(m[1]) : year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7]!.slice(0, 3))));
    if (out.length >= cap) break;
  }
  return out;
}

export function readLogcatInto(b: ModelBuilder, text: string, s: TraceSummary, align?: LogcatAlign | null, year = new Date().getFullYear()): LogcatResult {
  const format = logcatFormat(text.slice(0, 8192)) ?? "threadtime";
  let ref = align ?? null;
  let wallStartMs: number | null = null;
  const levels = new Map<string, number>();
  const tags = new Map<string, [number, number]>();
  const pids = new Set<number>();
  let lines = 0;
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos);
    if (nl < 0) nl = text.length;
    const line = text.slice(pos, nl).replace(/\r+$/, "");
    pos = nl + 1;
    if (!line || line.startsWith("--------- ")) continue;
    let pid: number;
    let tid: number;
    let prio: string;
    let tag: string;
    let msg: string;
    let ts = -1;
    let m: RegExpExecArray | null;
    if (format === "brief") {
      if (!(m = LOGCAT_BRIEF.exec(line))) continue;
      [prio, tag, pid, msg] = [m[1]!, m[2]!.trim(), Number(m[3]), m[4]!];
      tid = pid;
    } else {
      const tt = format === "threadtime";
      if (!(m = (tt ? LOGCAT_THREADTIME : LOGCAT_TIME).exec(line))) continue;
      const frac = m[7]!;
      const wall = Date.UTC(m[1] ? Number(m[1]) : year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number(frac.slice(0, 3)));
      if (!ref) ref = { wallMs: wall, ts: 0 };
      if (wallStartMs === null) {
        const d = new Date(wall);
        wallStartMs = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()).getTime();
      }
      ts = ref.ts + (wall - ref.wallMs) * 1e6 + (frac.length > 3 ? Math.round(Number(`0.${frac.slice(3)}`) * 1e6) : 0);
      if (tt) [pid, tid, prio, tag, msg] = [Number(m[8]), Number(m[9]), m[10]!, m[11]!, m[12] ?? ""];
      else [prio, tag, pid, msg] = [m[8]!, m[9]!.trim(), Number(m[10]), m[11]!];
      if (!tt) tid = pid;
    }
    lines++;
    const p = PRIO[prio] ?? 0;
    s.logTotal++;
    if (s.logs.length < LOG_CAP) s.logs.push({ ts: ts < 0 ? 0 : ts, pid, tid: tid!, prio: p, tag, msg });
    levels.set(prio, (levels.get(prio) ?? 0) + 1);
    const tg = tags.get(tag) ?? [0, 0];
    tg[0]++;
    tags.set(tag, tg);
    pids.add(pid);
    // ActivityManager names the processes it starts.
    if (tag === "ActivityManager" && msg.startsWith("Start proc ")) {
      const a = /^Start proc (\d+):([^/\s]+)/.exec(msg) ?? /^Start proc ([^\s/]+).*?pid=(\d+)/.exec(msg);
      if (a) {
        const [p0, name] = /^\d+$/.test(a[1]!) ? [Number(a[1]), a[2]!] : [Number(a[2]), a[1]!];
        b.process(p0, name);
      }
    }
    if (ts >= 0) {
      b.thread(tid!, pid > 0 ? pid : undefined);
      b.slice(`t:${tid!}`, ts, 0, b.name(tag || "log"), b.arg(`${prio} ${tag}: ${msg}`));
    }
  }
  const rows = [...tags].map(([k, [n]]) => [k, n] as (string | number)[]).sort((a, c) => (c[1] as number) - (a[1] as number)).slice(0, 200);
  return {
    lines,
    wallStartMs,
    stats: {
      facts: [
        { key: "logLines", value: lines, kind: "count" },
        { key: "logFormat", value: format, kind: "text" },
        { key: "tabProcesses", value: pids.size, kind: "count" },
      ],
      tables: [
        { title: "logByLevel", cols: [{ key: "level", kind: "text" }, { key: "count", kind: "count" }], rows: LEVELS.filter((l) => l && levels.has(l)).map((l) => [l, levels.get(l)!]), bar: 1 },
{ title: "logByTag", cols: [{ key: "tag", kind: "text" }, { key: "count", kind: "count" }], rows, bar: 1 }],
    },
  };
}
