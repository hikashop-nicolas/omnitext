import { STRACE_LINE } from "../formats/trace-detect";
import type { ModelBuilder } from "./trace-model";
import { tally, type TraceStats } from "./trace-stats";

// strace text output (-f, -tt / -ttt, -T): each system call a slice on its thread. A call cut
// by another thread's line ("<unfinished ...>") ends at its "<... name resumed>" line; signals
// and exits are instants. clone() results tell threads (CLONE_THREAD) from new processes.

interface Open {
  name: string;
  ts: number;
  args: string;
}

const COMPLETE = /^([a-z_][a-z0-9_]*)\((.*)\)\s+=\s+(.*?)(?:\s+<(\d+(?:\.\d+)?)>)?$/;
const UNFINISHED = /^([a-z_][a-z0-9_]*)\((.*?)\s*<unfinished \.\.\.>$/;
const RESUMED = /^<\.\.\. ([a-z_][a-z0-9_]*) resumed>\s?(.*)$/;
const TAIL = /^(.*)\)\s+=\s+(.*?)(?:\s+<(\d+(?:\.\d+)?)>)?$/;

/** Seconds and fraction as written, to whole ns, without a float's rounding at epoch scale. */
const fracNs = (frac: string | undefined): number => (frac ? Math.round(Number(`0${frac}`) * 1e9) : 0);

export interface StraceResult {
  stats: TraceStats;
  /** Wall-clock ms of the first line, for -ttt traces. */
  wallStartMs: number | null;
}

export function readStraceInto(b: ModelBuilder, text: string): StraceResult {
  const lines = text.split("\n");
  // Lines without a pid belong to the first process (strace -f leaves it out until a second
  // process is attached), or to a process of its own when no line names one.
  let root = 0;
  for (const l of lines) {
    const m = STRACE_LINE.exec(l);
    if (m && (m[1] || m[2])) {
      root = Number(m[1] ?? m[2]);
      break;
    }
  }
  if (root === 0) root = 1;
  const pidOf = new Map<number, number>([[root, root]]);
  const open = new Map<number, Open>();
  const calls = new Map<string, [number, number]>();
  const errs = new Map<string, number>();
  const signals = new Map<string, [number, number]>();
  let base: number | null = null; // -ttt: whole seconds of the first line
  let wallStartMs: number | null = null;
  let dayShift = 0;
  let lastTod = -1;
  let timed = false;
  let skipped = 0;
  let total = 0;
  let errors = 0;
  const names = new Map<number, string>();
  // Threads join their process at the end: a child often shows before clone() returns.
  const thread = (tid: number) => {
    if (!pidOf.has(tid)) pidOf.set(tid, tid);
  };
  const finish = (tid: number, name: string, ts: number, dur: number, args: string, ret: string) => {
    thread(tid);
    const err = /^-1 /.test(ret);
    b.slice(`t:${tid}`, ts, dur, b.name(name), b.arg(`${name}(${args})\n= ${ret}`));
    const c = calls.get(name) ?? [0, 0];
    c[0]++;
    c[1] += dur;
    calls.set(name, c);
    total++;
    if (err) {
      errors++;
      errs.set(name, (errs.get(name) ?? 0) + 1);
    }
    // A new task: a thread of the caller's process, or a process of its own.
    const child = Number(ret);
    if (/^(?:clone3?|fork|vfork)$/.test(name) && child > 0) {
      pidOf.set(child, /CLONE_THREAD/.test(args) ? (pidOf.get(tid) ?? tid) : child);
      thread(child);
    }
    if (name === "execve" && ret === "0") {
      const path = /^"([^"]*)"/.exec(args)?.[1];
      if (path) {
        const base = path.slice(path.lastIndexOf("/") + 1);
        names.set(tid, base);
      }
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r+$/, "");
    if (!line.trim()) continue;
    const m = STRACE_LINE.exec(line);
    if (!m) continue;
    const tid = m[1] || m[2] ? Number(m[1] ?? m[2]) : root;
    const body = m[9]!;
    let ts: number;
    if (m[3] !== undefined) {
      // -t / -tt: the time of day, carried over midnight.
      const tod = Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]);
      if (lastTod >= 0 && tod < lastTod - 43200) dayShift += 86400;
      lastTod = tod;
      ts = (tod + dayShift) * 1e9 + fracNs(m[6]);
      timed = true;
    } else if (m[7] !== undefined) {
      const sec = Number(m[7]);
      if (base === null) {
        base = sec;
        if (sec > 1e8) wallStartMs = sec * 1000 + fracNs(m[8]) / 1e6;
      }
      ts = (sec - base) * 1e9 + fracNs(m[8]);
      timed = true;
    } else ts = i * 1000; // no time: one line, one microsecond, to keep the order
    let c: RegExpExecArray | null;
    if ((c = COMPLETE.exec(body))) {
      finish(tid, c[1]!, ts, c[4] ? Math.round(Number(c[4]) * 1e9) : 0, c[2]!, c[3]!);
    } else if ((c = UNFINISHED.exec(body))) {
      open.set(tid, { name: c[1]!, ts, args: c[2]! });
    } else if ((c = RESUMED.exec(body))) {
      const o = open.get(tid);
      open.delete(tid);
      const rest = c[2]!;
      const start = o && o.name === c[1] ? o.ts : ts;
      const head = o && o.name === c[1] ? o.args : "";
      if (/<unfinished \.\.\.>$/.test(rest)) {
        // Resumed and cut again: the first part ends here, a second one starts.
        finish(tid, c[1]!, start, ts - start, `${head} ${rest.replace(/\s*<unfinished \.\.\.>$/, "")}`.trim(), "?");
        open.set(tid, { name: c[1]!, ts, args: head });
      } else {
        const t = TAIL.exec(rest);
        finish(tid, c[1]!, start, ts - start, `${head} ${t ? t[1] : rest}`.trim(), t ? t[2]! : "?");
      }
    } else if (/^--- (SIG[A-Z0-9]+)/.test(body)) {
      thread(tid);
      const sig = /^--- (SIG[A-Z0-9]+)/.exec(body)![1]!;
      b.slice(`t:${tid}`, ts, 0, b.name(sig), b.arg(body));
      const s = signals.get(sig) ?? [0, 0];
      s[0]++;
      signals.set(sig, s);
    } else if (/^\+\+\+ (.*) \+\+\+$/.test(body)) {
      thread(tid);
      b.slice(`t:${tid}`, ts, 0, b.name(/^\+\+\+ (.*) \+\+\+$/.exec(body)![1]!), -1);
    } else {
      skipped++;
      continue;
    }
  }
  // Calls still waiting at the end of the output.
  for (const [tid, o] of open) finish(tid, o.name, o.ts, 0, o.args, "?");
  for (const [tid, pid] of pidOf) {
    b.thread(tid, pid, names.get(tid));
    if (tid === pid && names.has(tid)) b.process(pid, names.get(tid));
  }
  const procs = new Set(pidOf.values());
  const stats: TraceStats = {
    facts: [
      { key: "straceCalls", value: total, kind: "count" },
      { key: "straceErrors", value: errors, kind: "count" },
      { key: "tabProcesses", value: procs.size, kind: "count" },
      { key: "threads", value: pidOf.size, kind: "count" },
    ],
    tables: [
      {
        title: "straceByCall",
        cols: [{ key: "straceCall", kind: "text" }, { key: "count", kind: "count" }, { key: "straceTime", kind: "dur" }, { key: "straceErrorsCol", kind: "count" }],
        rows: tally(calls, 1).map((r) => [...r, errs.get(r[0] as string) ?? 0]),
        bar: 1,
      },
    ],
  };
  if (!timed) stats.facts.push({ key: "straceNoTime", value: "", kind: "text" });
  if (signals.size) stats.tables.push({ title: "straceSignals", cols: [{ key: "straceSignal", kind: "text" }, { key: "count", kind: "count" }], rows: tally(signals, 1).map((r) => [r[0]!, r[1]!]), bar: 1 });
  if (skipped) stats.facts.push({ key: "linesSkipped", value: skipped, kind: "count" });
  return { stats, wallStartMs };
}
