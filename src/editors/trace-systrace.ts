import { ModelBuilder, kernelState, letterState, type TraceModel } from "./trace-model";
import { atraceEvent } from "./trace-atrace";
import { readChromeInto } from "./trace-chrome";

// Android systrace / ftrace text ("# tracer: nop" then one event per line), bare or inside the
// HTML file systrace writes. A line reads:
//   task-1234 ( 1200) [002] d..3  5000.123456: sched_switch: prev_comm=... ==> next_comm=...
// The tgid column and the flags column are optional (older kernels and tools leave them out).

const LINE = /^\s*(.+?)-(\d+)\s+(?:\(\s*(\d+|-+)\)\s+)?\[(\d+)\]\s+(?:[\w.]{4,5}\s+)?(\d+\.\d+):\s+([\w:]+):\s?(.*)$/;
// The function tracer: "bash-1234 [001] .... 5000.123456: do_sys_open <-sys_open".
const FUNC = /^\s*(.+?)-(\d+)\s+(?:\(\s*(?:\d+|-+)\)\s+)?\[(\d+)\]\s+(?:[\w.]{4,5}\s+)?(\d+\.\d+):\s+([\w.$]+)\s+<-(\S+)/;
// function_graph with funcgraph-abstime: "5000.123 |  1)  bash-1234  | d..2 |  0.913 us  |  func();".
const GRAPH = /^\s*(\d+\.\d+)\s+\|\s+(\d+)\)\s+(?:(.+?)-(\d+)\s+\|\s+)?(?:[\w.]{4,5}\s+\|\s+)?(?:[+!#*@$]\s*)?(?:([\d.]+) us\s+)?\|\s(.*)$/;

export interface SystraceResult {
  model: TraceModel;
  ftrace: Map<string, number>;
  ftraceTotal: number;
  cpus: Set<number>;
}

/** The trace text blocks of a systrace HTML page, or the text itself when it is not one. */
export function systraceBlocks(text: string): { ftrace: string[]; json: string[] } {
  if (!/<script[^>]*class="trace-data"/.test(text)) return { ftrace: [text], json: [] };
  const out = { ftrace: [] as string[], json: [] as string[] };
  const re = /<script[^>]*class="trace-data"[^>]*>([\s\S]*?)<\/script>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const body = m[1]!.trim();
    if (body.startsWith("{") || body.startsWith("[")) out.json.push(body);
    else if (body) out.ftrace.push(body);
  }
  return out;
}

const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

export async function readSystrace(text: string): Promise<SystraceResult> {
  const b = new ModelBuilder();
  const counts = new Map<string, number>();
  const cpus = new Set<number>();
  const blocks = systraceBlocks(text);
  let total = 0;
  for (const block of blocks.ftrace) total += await readSystraceInto(b, block, counts, cpus);
  if (blocks.json.length) {
    for (const j of blocks.json) {
      try {
        await readChromeInto(b, JSON.parse(j));
      } catch {
        /* a damaged block leaves the rest */
      }
    }
  }
  return { model: b.finish(), ftrace: counts, ftraceTotal: total, cpus };
}

/** Adds the events of one ftrace text block; returns how many event lines it read. */
export async function readSystraceInto(b: ModelBuilder, text: string, counts?: Map<string, number>, cpus?: Set<number>): Promise<number> {
  let n = 0;
  let pos = 0;
  let t0 = performance.now();
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos);
    if (nl < 0) nl = text.length;
    let line = text.slice(pos, nl);
    pos = nl + 1;
    // Early systrace pages hold the text as a JavaScript string: each line ends in \n\.
    if (line.endsWith("\\n\\")) line = line.slice(0, -3);
    if (!line || line.charCodeAt(0) === 35 /* # */) continue;
    const m = LINE.exec(line);
    if (!m) {
      if (graphLine(b, line) || funcLine(b, line, cpus)) n++;
      continue;
    }
    n++;
    const comm = m[1]!.trim();
    const tid = Number(m[2]);
    const tgid = m[3] && /^\d+$/.test(m[3]) ? Number(m[3]) : undefined;
    const cpu = Number(m[4]);
    const ts = Math.round(Number(m[5]) * 1e9);
    let event = m[6]!;
    let args = m[7]!;
    cpus?.add(cpu);
    if (tid > 0) b.thread(tid, tgid, b.threads.get(tid)?.name ?? (comm === "<...>" ? undefined : comm));
    if (event === "print" && args.startsWith("tracing_mark_write: ")) {
      args = args.slice(20);
      event = "tracing_mark_write";
    }
    counts?.set(event, (counts.get(event) ?? 0) + 1);
    // The marker systrace adds to line up with Chrome's clock is not a trace event (often at 0).
    if (args.startsWith("trace_event_clock_sync:")) continue;
    b.time(ts);
    if (event === "sched_switch") {
      const next = /next_comm=(.*?) next_pid=(\d+)/.exec(args);
      if (next) {
        const pid = Number(next[2]);
        if (pid > 0 && !b.threads.get(pid)?.name) b.thread(pid, undefined, next[1]);
        const prev = /prev_state=(\S+)/.exec(args);
        b.switchTo(cpu, ts, pid, prev ? prevState(prev[1]!) : -1);
      }
    } else if (event === "sched_waking" || event === "sched_wakeup" || event === "sched_wakeup_new") {
      const w = /(?:^|\s)pid=(\d+)/.exec(args);
      if (w) b.waking(ts, Number(w[1]));
    } else if (event === "tracing_mark_write" || event === "print" || event === "0") {
      atraceEvent(b, ts, tid, args);
    } else if (event === "cpu_frequency") {
      const f = /state=(\d+) cpu_id=(\d+)/.exec(args);
      if (f) b.counter(`cpufreq:${f[2]}`, ts, Number(f[1]), { label: `CPU ${f[2]} freq (kHz)`, cpu: Number(f[2]) });
    }
    if ((n & 16383) === 0 && performance.now() - t0 > 30) {
      await tick();
      t0 = performance.now();
    }
  }
  return n;
}

/** prev_state as a letter ("S", "R+") or, from older kernels and trace-cmd, a number ("0x1"). */
function prevState(s: string): number {
  return /^(?:0x[\da-f]+|\d+)$/i.test(s) ? kernelState(parseInt(s)) : letterState(s);
}

function funcLine(b: ModelBuilder, line: string, cpus?: Set<number>): boolean {
  const m = FUNC.exec(line);
  if (!m) return false;
  const tid = Number(m[2]);
  const ts = Math.round(Number(m[4]) * 1e9);
  cpus?.add(Number(m[3]));
  if (tid > 0) b.thread(tid, undefined, b.threads.get(tid)?.name ?? (m[1]!.trim() === "<...>" ? undefined : m[1]!.trim()));
  b.slice(tid > 0 ? `t:${tid}` : `fn:${m[3]}`, ts, 0, b.name(m[5]!), b.arg(`<- ${m[6]}`));
  if (tid <= 0) b.describe(`fn:${m[3]}`, { label: `CPU ${m[3]}` });
  return true;
}

function graphLine(b: ModelBuilder, line: string): boolean {
  const m = GRAPH.exec(line);
  if (!m) return false;
  const ts = Math.round(Number(m[1]) * 1e9);
  const tid = m[4] ? Number(m[4]) : 0;
  const key = tid > 0 ? `t:${tid}` : `fg:${m[2]}`;
  if (tid > 0) b.thread(tid, undefined, b.threads.get(tid)?.name ?? m[3]!.trim());
  else b.describe(key, { label: `CPU ${m[2]}` });
  const body = m[6]!.trim();
  if (body.endsWith("{")) b.begin(`fg${key}`, key, ts, b.name(body.slice(0, -1).replace(/\(\)\s*$/, "").trim()));
  else if (body.startsWith("}")) b.end(`fg${key}`, ts);
  else if (body.endsWith(";")) b.slice(key, ts, Math.round(Number(m[5] ?? 0) * 1000), b.name(body.slice(0, -1).replace(/\(\)$/, "")));
  else return false;
  return true;
}
