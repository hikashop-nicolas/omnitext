import { ModelBuilder, type TraceModel } from "./trace-model";
import { atraceEvent } from "./trace-atrace";
import { readChromeInto } from "./trace-chrome";

// Android systrace / ftrace text ("# tracer: nop" then one event per line), bare or inside the
// HTML file systrace writes. A line reads:
//   task-1234 ( 1200) [002] d..3  5000.123456: sched_switch: prev_comm=... ==> next_comm=...
// The tgid column and the flags column are optional (older kernels and tools leave them out).

const LINE = /^\s*(.+?)-(\d+)\s+(?:\(\s*(\d+|-+)\)\s+)?\[(\d+)\]\s+(?:[\w.]{4,5}\s+)?(\d+\.\d+):\s+([\w:]+):\s?(.*)$/;

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
    const line = text.slice(pos, nl);
    pos = nl + 1;
    if (!line || line.charCodeAt(0) === 35 /* # */) continue;
    const m = LINE.exec(line);
    if (!m) continue;
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
    b.time(ts);
    if (event === "sched_switch") {
      const next = /next_comm=(.*?) next_pid=(\d+)/.exec(args);
      if (next) {
        const pid = Number(next[2]);
        if (pid > 0 && !b.threads.get(pid)?.name) b.thread(pid, undefined, next[1]);
        b.switchTo(cpu, ts, pid);
      }
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
