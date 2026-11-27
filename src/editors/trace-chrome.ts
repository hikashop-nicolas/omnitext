import { ModelBuilder, type TraceModel } from "./trace-model";
import { readSystraceInto } from "./trace-systrace";

// Chrome / Catapult JSON traces ({"traceEvents": [...]} or a bare array). Times are in
// microseconds. Phases read: B/E, X, i/I/R/n instants, C counters, b/e and S/F async, s/t/f flows and
// bind_id flows, M metadata.

interface ChromeEvent {
  ph?: string;
  name?: string;
  cat?: string;
  ts?: number;
  dur?: number;
  pid?: number | string;
  tid?: number | string;
  id?: number | string;
  id2?: { local?: string | number; global?: string | number };
  s?: string;
  bp?: string;
  bind_id?: number | string;
  flow_in?: boolean;
  flow_out?: boolean;
  args?: Record<string, unknown>;
}

const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

export async function readChromeTrace(text: string, onProgress?: (done: number) => void): Promise<TraceModel> {
  const b = new ModelBuilder();
  await readChromeInto(b, JSON.parse(text) as unknown, onProgress);
  return b.finish();
}

export async function readChromeInto(b: ModelBuilder, json: unknown, onProgress?: (done: number) => void): Promise<void> {
  const root = json as { traceEvents?: unknown; systemTraceEvents?: unknown };
  const events = (Array.isArray(json) ? json : Array.isArray(root?.traceEvents) ? root.traceEvents : []) as ChromeEvent[];
  // Ids may be strings: they get numbers of their own, past any real pid or tid.
  const ids = new Map<string, number>();
  let nextId = 1 << 30;
  const num = (v: number | string | undefined): number => {
    if (typeof v === "number") return v;
    if (v === undefined) return 0;
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v) return n;
    let id = ids.get(v);
    if (id === undefined) ids.set(v, (id = nextId++));
    return id;
  };
  const argOf = (e: ChromeEvent): number => {
    if (!e.args || !Object.keys(e.args).length) return -1;
    try {
      return b.arg(JSON.stringify(e.args, null, 1));
    } catch {
      return -1;
    }
  };
  let t0 = performance.now();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || typeof e !== "object") continue;
    const ph = e.ph ?? "";
    const pid = num(e.pid);
    const tid = num(e.tid ?? e.pid);
    const ts = typeof e.ts === "number" ? e.ts * 1000 : NaN;
    if (ph === "M") {
      const name = typeof e.args?.name === "string" ? e.args.name : undefined;
      if (e.name === "process_name") b.process(pid, name);
      else if (e.name === "thread_name") b.thread(tid, pid, name);
      continue;
    }
    if (!Number.isFinite(ts)) continue;
    const track = `t:${tid}`;
    if (ph === "X" || ph === "B" || ph === "E" || ph === "i" || ph === "I" || ph === "R") b.thread(tid, pid);
    else if (pid && !b.processes.has(pid)) b.process(pid);
    let sid = -1;
    switch (ph) {
      case "X":
        sid = b.slice(track, ts, Math.max(0, (e.dur ?? 0) * 1000), b.name(e.name ?? ""), argOf(e));
        break;
      case "B":
        sid = b.begin(track, track, ts, b.name(e.name ?? ""), argOf(e));
        break;
      case "s":
      case "t":
      case "f": {
        // Flow v1: start and step bind to the slice around them, an end to the next one
        // unless "bp" is "e".
        const id = e.id ?? e.id2?.local ?? e.id2?.global ?? "";
        b.thread(tid, pid);
        b.flowPoint(`${e.cat ?? ""}:${e.name ?? ""}:${id}`, track, ts, ph === "s" ? 0 : ph === "t" ? 1 : 2, ph === "f" && e.bp !== "e");
        break;
      }
      case "E":
        b.end(track, ts);
        break;
      case "i":
      case "I":
      case "R": {
        const name = b.name(e.name ?? "");
        if (e.s === "g") {
          b.describe("g:instants", { label: "Global" });
          b.slice("g:instants", ts, 0, name, argOf(e));
        } else if (e.s === "p") {
          b.describe(`pi:${pid}`, { label: "Instants", pid });
          b.slice(`pi:${pid}`, ts, 0, name, argOf(e));
        } else b.slice(track, ts, 0, name, argOf(e));
        break;
      }
      case "C":
        for (const [k, v] of Object.entries(e.args ?? {})) {
          const value = typeof v === "number" ? v : Number(v);
          if (!Number.isFinite(value)) continue;
          // Named as Perfetto names them: the event name, then the series.
          const label = e.name ? `${e.name} ${k}` : k;
          const id = e.id !== undefined ? ` ${e.id}` : "";
          b.counter(`c:${pid}:${label}${id}`, ts, value, { label: label + id, pid });
        }
        break;
      case "b":
      case "e":
      case "n":
      case "S":
      case "F": {
        // A track per category and id, named after its first slice (an end may carry no
        // name); tracks of one name share a row.
        // An id2.local is the process's own; other ids match across processes.
        const name = e.name ?? "";
        const local = e.id2?.local !== undefined;
        const id = e.id ?? e.id2?.local ?? e.id2?.global ?? "";
        const track = `a:${pid}:${e.cat ?? ""}:${id}`;
        const match = local ? track : `a:g:${e.cat ?? ""}:${id}`;
        b.describe(track, { pid });
        if (ph === "b" || ph === "S") sid = b.begin(match, track, ts, b.name(name), argOf(e));
        else if (ph === "e" || ph === "F") b.end(match, ts);
        else sid = b.slice(track, ts, 0, b.name(name), argOf(e));
        break;
      }
    }
    // Flow v2: slices that share a bind_id are linked, in to out.
    if (sid >= 0 && e.bind_id !== undefined && (e.flow_in || e.flow_out)) {
      b.flowId(`v2:${e.bind_id}`, sid, ts, !!e.flow_in && !e.flow_out);
    }
    if ((i & 8191) === 0 && performance.now() - t0 > 30) {
      onProgress?.(i / events.length);
      await tick();
      t0 = performance.now();
    }
  }
  // Android traces captured with Chrome tooling carry the kernel trace as text alongside.
  if (typeof root?.systemTraceEvents === "string") await readSystraceInto(b, root.systemTraceEvents);
}
