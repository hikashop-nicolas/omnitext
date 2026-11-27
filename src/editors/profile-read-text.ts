import { ProfileBuilder, baseName, guessCategory, stripOffset, type Profile } from "./profile-model";

// Text profiles: collapsed stacks ("a;b;c 12", Brendan Gregg's stackcollapse output) and the
// output of `perf script` / `simpleperf report-sample` (a header line per sample, then frames).

const COLLAPSED_LINE = /^(\S.*?)\s+(\d+(?:\.\d+)?)$/;

/** FlameGraph's frame annotations: _[k] kernel, _[j] JIT, _[i] inlined, _[w] waker. */
function collapsedFrame(b: ProfileBuilder, raw: string): number {
  const ann = /_\[([kjiw])\]$/.exec(raw);
  const name = ann ? raw.slice(0, -4) : raw;
  const cat = ann?.[1] === "k" ? "Kernel" : ann?.[1] === "j" ? "Java" : ann?.[1] === "i" ? "Inlined" : guessCollapsed(name);
  return b.frame(name, "", cat);
}

// Collapsed stacks carry no module: a few name shapes still tell the language.
function guessCollapsed(name: string): string {
  if (/^L?[a-z][\w$]*(?:[/.][\w$]+){2,}[;:]?/.test(name) && !name.includes("::")) return "Java";
  if (/\.(?:m?js|ts):\d+|^\(anonymous\)|^\(program\)|^\(garbage collector\)/.test(name)) return "JavaScript";
  if (/\.py:\d+|\(\S+\.py\)|^<module>/.test(name)) return "Python";
  return "";
}

export function readCollapsed(text: string): Profile {
  const b = new ProfileBuilder();
  const thread = b.thread("", { name: "" });
  let skipped = 0;
  let start = 0;
  const frames: number[] = [];
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    let line = text.slice(start, end);
    start = end + 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim() || line.startsWith("#") || line.startsWith("//")) continue;
    const m = COLLAPSED_LINE.exec(line);
    if (!m) {
      skipped++;
      continue;
    }
    frames.length = 0;
    for (const part of m[1]!.split(";")) if (part) frames.push(collapsedFrame(b, part));
    b.sample(b.stackOf(frames), thread, Number(m[2]));
  }
  if (skipped) b.notes.push(`skipped:${skipped}`);
  return b.finish();
}

// --- perf script ------------------------------------------------------------------------------

/** "comm pid/tid [cpu] time: [period] event:", where old perf versions print no time. */
const PERF_HEAD = /^(\S.*?)\s+(?:(\d+)(?:\/(\d+))?\s+)?(?:\[(\d+)\]\s+)?(?:(\d+\.\d+):\s*)(.*)$/;
const PERF_HEAD_PID = /^(\S.*?)\s+(\d+)(?:\/(\d+))?\s+(?:\[(\d+)\]\s+)?()((?:\d+\s+)?[A-Za-z][\w/.:-]*?:(?:\s.*)?)$/;

interface PerfFrame {
  sym: string;
  dso: string;
}

/** One callchain line: "  7f00 sym+0x12 (/lib/x.so)"; the module is the last balanced (...). */
export function parsePerfFrame(line: string): PerfFrame | null {
  const s = line.trim();
  const sp = s.search(/\s/);
  if (sp <= 0 || !/^[0-9a-fA-F]+$/.test(s.slice(0, sp))) return null;
  let rest = s.slice(sp).trim();
  let dso = "";
  if (rest.endsWith(")")) {
    let depth = 0;
    for (let i = rest.length - 1; i >= 0; i--) {
      const c = rest[i];
      if (c === ")") depth++;
      else if (c === "(" && --depth === 0) {
        if (i === 0 || rest[i - 1] === " ") {
          dso = rest.slice(i + 1, -1);
          rest = rest.slice(0, i).trim();
        }
        break;
      }
    }
  }
  return { sym: stripOffset(rest) || "[unknown]", dso };
}

/** The event name after the time: "1000 cpu-clock:u: ..." to "cpu-clock:u", with the period. */
function perfEvent(rest: string): { event: string; period: number; tail: string } {
  let period = NaN;
  const p = /^(\d+)\s+/.exec(rest);
  if (p) {
    period = Number(p[1]);
    rest = rest.slice(p[0].length);
  }
  const m = /^(\S+?):(?:\s+|$)/.exec(rest);
  if (!m) return { event: rest.trim() || "event", period, tail: "" };
  return { event: m[1]!, period, tail: rest.slice(m[0].length) };
}

function perfFrameId(b: ProfileBuilder, f: PerfFrame): number {
  const module = f.dso === "[unknown]" ? "" : f.dso;
  // JIT-compiled Java from perf-map-agent: "Lorg/a/B;.run(I)V" reads as "org.a.B.run", as FlameGraph tidies it.
  const java = /^L([\w/$]+);\.([\w$<>]+)(?:\(|$)/.exec(f.sym);
  if (java) return b.frame(`${java[1]!.replace(/\//g, ".")}.${java[2]}`, module ? baseName(module) : "", "Java", module || undefined);
  return b.frame(f.sym, module ? baseName(module) : "", guessCategory(f.sym, module), module || undefined);
}

/**
 * Samples of `perf script` (with or without callchains, any number of event types). Each event
 * type is a value type counting samples, with its summed period beside it when perf printed one.
 */
export function readPerfScript(text: string): Profile {
  interface Raw {
    stack: number;
    thread: number;
    event: number;
    period: number;
    time: number;
  }
  const b = new ProfileBuilder();
  const events: string[] = [];
  const eventIds = new Map<string, number>();
  const hasPeriod: boolean[] = [];
  const raws: Raw[] = [];
  const lines = text.split("\n");
  let i = 0;
  let skipped = 0;
  const frames: number[] = [];
  while (i < lines.length) {
    let line = lines[i++]!;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^\s/.test(line)) {
      skipped++;
      continue;
    }
    const h = PERF_HEAD.exec(line) ?? PERF_HEAD_PID.exec(line);
    if (!h) {
      skipped++;
      continue;
    }
    const comm = h[1]!.trim();
    const pid = h[2] !== undefined ? Number(h[2]) : undefined;
    const tid = h[3] !== undefined ? Number(h[3]) : pid;
    const time = h[5] ? Number(h[5]) * 1e9 : NaN;
    const ev = perfEvent(h[6]!);
    let eid = eventIds.get(ev.event);
    if (eid === undefined) {
      eid = events.length;
      events.push(ev.event);
      eventIds.set(ev.event, eid);
      hasPeriod.push(false);
    }
    if (!Number.isNaN(ev.period)) hasPeriod[eid] = true;
    frames.length = 0;
    // Frames follow, leaf first, until a blank line or the next sample.
    while (i < lines.length && /^\s+\S/.test(lines[i]!)) {
      const f = parsePerfFrame(lines[i++]!);
      if (f) frames.push(perfFrameId(b, f));
    }
    // Without callchains the sample's own symbol sits on the header line.
    if (!frames.length && ev.tail) {
      const f = parsePerfFrame(ev.tail);
      if (f) frames.push(perfFrameId(b, f));
    }
    // A sample with no frame at all still counts, under its command.
    if (!frames.length) frames.push(b.frame(`[${comm}]`, "", ""));
    frames.reverse();
    const key = tid !== undefined ? String(tid) : comm;
    const thread = b.thread(key, { name: comm, ...(tid !== undefined ? { tid } : {}), ...(pid !== undefined ? { pid } : {}) });
    raws.push({ stack: b.stackOf(frames), thread, event: eid, period: Number.isNaN(ev.period) ? 1 : ev.period, time });
  }
  // Value types: samples of each event, then each event's period.
  const types: { type: string; unit: string; event: number; period: boolean; label?: "period" }[] = [];
  events.forEach((e, k) => types.push({ type: e, unit: "count", event: k, period: false }));
  events.forEach((e, k) => {
    if (hasPeriod[k]) types.push({ type: e, label: "period" as const, unit: /clock/.test(e) ? "nanoseconds" : "events", event: k, period: true });
  });
  const out = new ProfileBuilder(types.map((t) => ({ type: t.type, unit: t.unit, ...(t.label ? { label: t.label } : {}) })));
  // Rebuild in the final builder: same frames and stacks, in the same order.
  const remap = transplant(b, out);
  for (const t of b.threads) out.thread(String(out.threads.length), t);
  const vals = new Float64Array(types.length);
  for (const r of raws) {
    vals.fill(0);
    types.forEach((t, k) => {
      if (t.event === r.event) vals[k] = t.period ? r.period : 1;
    });
    out.sample(remap(r.stack), r.thread, vals, r.time);
  }
  // Process names: a pid's thread named after the pid, else its first thread's command.
  const procName = new Map<number | string, string>();
  for (const t of out.threads) if (t.pid !== undefined && (t.tid === t.pid || !procName.has(t.pid))) procName.set(t.pid, t.name);
  for (const t of out.threads) if (t.pid !== undefined) t.process = procName.get(t.pid)!;
  if (skipped) out.notes.push(`skipped:${skipped}`);
  // The event sampled most opens first.
  const counts = events.map(() => 0);
  for (const r of raws) counts[r.event]!++;
  return out.finish({ defaultValue: Math.max(0, counts.indexOf(Math.max(0, ...counts))) });
}

/** Copies frames and stacks from one builder to another; returns the stack id mapping. */
function transplant(from: ProfileBuilder, to: ProfileBuilder): (s: number) => number {
  const p = from.finish();
  const frameMap = p.frames.map((f) => to.frame(f.name, f.module, f.category, f.file, f.line));
  const stackMap = new Int32Array(p.stackFrame.length);
  for (let s = 0; s < stackMap.length; s++) {
    const parent = p.stackParent[s]!;
    stackMap[s] = to.stack(parent < 0 ? -1 : stackMap[parent]!, frameMap[p.stackFrame[s]!]!);
  }
  return (s) => stackMap[s]!;
}
