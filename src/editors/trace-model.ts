// The timeline model every trace reader fills: CPU scheduling rows, per-thread and per-process
// slice tracks (nested into levels), and counter tracks, all in ns on one clock.

/** Slices of one nesting level: sorted by start and never overlapping, so ends are sorted too. */
export interface SliceLevel {
  ts: Float64Array;
  dur: Float64Array;
  name: Int32Array;
  /** Index into TraceModel.args, or -1. */
  arg: Int32Array;
}

/** Scheduling state of a thread, as Perfetto names them. */
export const ThreadState = {
  Running: 0,
  Runnable: 1,
  Sleeping: 2,
  Uninterruptible: 3,
  Stopped: 4,
  Dead: 5,
  Idle: 6,
  Unknown: 7,
} as const;
export type ThreadState = (typeof ThreadState)[keyof typeof ThreadState];

/** A thread's states over time, from sched_switch and sched_waking: sorted, never overlapping. */
export interface ThreadStates {
  ts: Float64Array;
  dur: Float64Array;
  state: Uint8Array;
  /** The CPU of a Running interval, or -1. */
  cpu: Int16Array;
}

export interface SliceTrack {
  kind: "slices";
  id: number;
  label: string;
  tid?: number;
  pid?: number;
  levels: SliceLevel[];
  count: number;
  /** The thread's scheduling states, drawn as a strip above its slices. */
  states?: ThreadStates;
}

/** A slice of the model; level -1 is the track's thread state strip. */
export interface SliceRef {
  track: SliceTrack;
  level: number;
  index: number;
}

/** A flow arrow from the end of one slice to the start of another. */
export interface Flow {
  from: SliceRef;
  to: SliceRef;
}

export interface CpuTrack {
  kind: "cpu";
  id: number;
  label: string;
  cpu: number;
  ts: Float64Array;
  dur: Float64Array;
  tid: Int32Array;
  count: number;
}

export interface CounterTrack {
  kind: "counter";
  id: number;
  label: string;
  pid?: number;
  ts: Float64Array;
  val: Float64Array;
  min: number;
  max: number;
}

export type Track = SliceTrack | CpuTrack | CounterTrack;

export interface TrackGroup {
  key: string;
  label: string;
  pid?: number;
  tracks: Track[];
}

export interface ThreadMeta {
  tid: number;
  pid?: number;
  name?: string;
}

export interface TraceModel {
  start: number;
  end: number;
  names: string[];
  /** How many slices carry each name. */
  nameCount: Int32Array;
  args: string[];
  groups: TrackGroup[];
  threads: Map<number, ThreadMeta>;
  processes: Map<number, { pid: number; name?: string }>;
  sliceCount: number;
  schedCount: number;
  flows: Flow[];
}

interface Intervals {
  ts: number[];
  dur: number[];
  name: number[];
  arg: number[];
  /** Slice ids, for flows to find their ends. */
  sid: number[];
}

interface TrackMeta {
  label?: string;
  tid?: number;
  pid?: number;
}

const emptyIntervals = (): Intervals => ({ ts: [], dur: [], name: [], arg: [], sid: [] });

/** A flow end bound by time: the slice of `track` enclosing `ts`, or the next one to start. */
interface FlowPoint {
  id: string;
  track: string;
  ts: number;
  /** 0 start, 1 step, 2 end. */
  step: number;
  next: boolean;
}

/** Kernel prev_state bits (TASK_REPORT order) to a ThreadState. */
export function kernelState(v: number): number {
  const low = v & 0xff;
  if (low === 0) return ThreadState.Runnable; // R, or R+ (preempted)
  if (low & 2) return ThreadState.Uninterruptible;
  if (low & 1) return ThreadState.Sleeping;
  if (low & 0x80) return ThreadState.Idle;
  if (low & 0x0c) return ThreadState.Stopped;
  if (low & 0x30) return ThreadState.Dead;
  if (low & 0x40) return ThreadState.Sleeping; // parked
  return ThreadState.Unknown;
}

/** A prev_state as text ftrace prints it ("S", "R+", "D|K", "x") to a ThreadState. */
export function letterState(s: string): number {
  const c = s.trim()[0];
  switch (c) {
    case "R": return ThreadState.Runnable;
    case "S": return ThreadState.Sleeping;
    case "D": return ThreadState.Uninterruptible;
    case "T": case "t": return ThreadState.Stopped;
    case "X": case "Z": case "x": return ThreadState.Dead;
    case "I": return ThreadState.Idle;
    case "P": case "W": case "K": return ThreadState.Sleeping;
  }
  return ThreadState.Unknown;
}

/**
 * Collects events from a reader. Track keys: "t:<tid>" for a thread, anything else for a track
 * described with describe(); keys may be aliased later (Perfetto descriptors can arrive late).
 */
export class ModelBuilder {
  private nameIds = new Map<string, number>();
  readonly names: string[] = [];
  readonly args: string[] = [];
  private intervals = new Map<string, Intervals>();
  private meta = new Map<string, TrackMeta>();
  private aliases = new Map<string, string>();
  private sched = new Map<number, { ts: number[]; tid: number[]; prev: number[] }>();
  private wakes = { ts: [] as number[], tid: [] as number[] };
  private sid = 0;
  private flowIds: { id: string; sid: number; ts: number; end: boolean }[] = [];
  private flowPairs: [number, number][] = [];
  private flowPoints: FlowPoint[] = [];
  private counters = new Map<string, { ts: number[]; val: number[]; meta: TrackMeta; cpu?: number }>();
  // Begin/end events are applied in time order at the end, whatever order they arrived in.
  private be = { ts: [] as number[], kind: [] as number[], match: [] as string[], track: [] as string[], name: [] as number[], arg: [] as number[], sid: [] as number[], tt: [] as number[] };
  readonly threads = new Map<number, ThreadMeta>();
  readonly processes = new Map<number, { pid: number; name?: string }>();
  private lo = Infinity;
  private hi = -Infinity;

  name(s: string): number {
    let id = this.nameIds.get(s);
    if (id === undefined) {
      id = this.names.length;
      this.names.push(s);
      this.nameIds.set(s, id);
    }
    return id;
  }

  arg(s: string): number {
    this.args.push(s.length > 4000 ? s.slice(0, 4000) + "…" : s);
    return this.args.length - 1;
  }

  time(ts: number): void {
    if (!(ts > -Infinity && ts < Infinity)) return;
    if (ts < this.lo) this.lo = ts;
    if (ts > this.hi) this.hi = ts;
  }

  thread(tid: number, pid?: number, name?: string): void {
    let t = this.threads.get(tid);
    if (!t) this.threads.set(tid, (t = { tid }));
    if (pid !== undefined && pid > 0 && t.pid === undefined) t.pid = pid;
    if (name) t.name = name;
    if (t.pid !== undefined && !this.processes.has(t.pid)) this.processes.set(t.pid, { pid: t.pid });
  }

  process(pid: number, name?: string): void {
    let p = this.processes.get(pid);
    if (!p) this.processes.set(pid, (p = { pid }));
    if (name) p.name = name;
  }

  describe(key: string, meta: TrackMeta): void {
    this.meta.set(key, { ...this.meta.get(key), ...meta });
  }

  alias(key: string, to: string): void {
    this.aliases.set(key, to);
  }

  private resolve(key: string): string {
    for (let i = 0; i < 8; i++) {
      const next = this.aliases.get(key);
      if (next === undefined || next === key) break;
      key = next;
    }
    return key;
  }

  /** Adds a slice; returns its id, for flows. */
  slice(track: string, ts: number, dur: number, name: number, arg = -1, sid = this.sid++): number {
    let iv = this.intervals.get(track);
    if (!iv) this.intervals.set(track, (iv = emptyIntervals()));
    iv.ts.push(ts);
    iv.dur.push(dur);
    iv.name.push(name);
    iv.arg.push(arg);
    iv.sid.push(sid);
    this.time(ts);
    if (dur > 0) this.time(ts + dur);
    return sid;
  }

  /**
   * Opens a slice that a matching end() closes; returns the id the slice will have. `tt` is
   * the thread time in µs when the source gives it: with the end's, it adds the thread duration.
   */
  begin(match: string, track: string, ts: number, name: number, arg = -1, tt = -1): number {
    const sid = this.sid++;
    this.pushBE(1, match, track, ts, name, arg, sid, tt);
    return sid;
  }

  end(match: string, ts: number, tt = -1): void {
    this.pushBE(2, match, "", ts, -1, -1, -1, tt);
  }

  private pushBE(kind: number, match: string, track: string, ts: number, name: number, arg: number, sid: number, tt: number): void {
    const b = this.be;
    b.tt.push(tt);
    b.ts.push(ts);
    b.kind.push(kind);
    b.match.push(match);
    b.track.push(track);
    b.name.push(name);
    b.arg.push(arg);
    b.sid.push(sid);
    this.time(ts);
  }

  /** A flow arrow between two slice ids. */
  flow(from: number, to: number): void {
    if (from >= 0 && to >= 0 && from !== to) this.flowPairs.push([from, to]);
  }

  /** Slice `sid` carries flow `id`: it follows the previous slice with that id; `end` closes it. */
  flowId(id: string, sid: number, ts: number, end = false): void {
    if (sid >= 0) this.flowIds.push({ id, sid, ts, end });
  }

  /** A flow step bound to the slice of `track` around `ts` (or the next one, for an end with `next`). */
  flowPoint(id: string, track: string, ts: number, step: number, next = false): void {
    this.flowPoints.push({ id, track, ts, step, next });
  }

  /**
   * CPU `cpu` switches to thread `tid` at `ts` (0 is the idle task). `prev` is the state the
   * outgoing thread is left in, a ThreadState, or -1 when the source does not say.
   */
  switchTo(cpu: number, ts: number, tid: number, prev = -1): void {
    let s = this.sched.get(cpu);
    if (!s) this.sched.set(cpu, (s = { ts: [], tid: [], prev: [] }));
    s.ts.push(ts);
    s.tid.push(tid);
    s.prev.push(prev);
    this.time(ts);
  }

  /** Thread `tid` is woken (sched_waking or sched_wakeup): it is runnable from `ts`. */
  waking(ts: number, tid: number): void {
    if (tid <= 0) return;
    this.wakes.ts.push(ts);
    this.wakes.tid.push(tid);
  }

  counter(key: string, ts: number, value: number, meta: TrackMeta & { cpu?: number } = {}): void {
    let c = this.counters.get(key);
    if (!c) this.counters.set(key, (c = { ts: [], val: [], meta, cpu: meta.cpu }));
    c.ts.push(ts);
    c.val.push(value);
    this.time(ts);
  }

  get empty(): boolean {
    return this.lo === Infinity;
  }

  finish(): TraceModel {
    const start = this.lo === Infinity ? 0 : this.lo;
    const end = this.hi === -Infinity ? 0 : Math.max(this.hi, start);
    this.applyBeginEnd(end);
    let id = 0;
    const groups = new Map<string, TrackGroup>();
    const group = (key: string, label: string, pid?: number): TrackGroup => {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, label, pid, tracks: [] }));
      return g;
    };
    const procLabel = (pid: number) => {
      const name = this.processes.get(pid)?.name ?? (this.threads.get(pid)?.name);
      return name ? `${name} ${pid}` : `${pid}`;
    };
    const cpuGroup = group("cpu", "CPU");
    let schedCount = 0;
    for (const cpu of [...this.sched.keys()].sort((a, b) => a - b)) {
      const t = buildCpu(this.sched.get(cpu)!, end, id++, cpu);
      schedCount += t.count;
      cpuGroup.tracks.push(t);
    }
    const states = this.buildStates(end);
    const counters = [...this.counters].map(([key, c]) => ({ key: this.resolve(key), c }));
    for (const { key, c } of counters) {
      const meta = { ...c.meta, ...this.meta.get(key) };
      const track = buildCounter(c, id++, meta.label ?? key, meta.pid);
      if (c.cpu !== undefined) cpuGroup.tracks.push(track);
      else if (meta.pid !== undefined) group(`p:${meta.pid}`, "", meta.pid).tracks.push(track);
      else group("global", "").tracks.push(track);
    }
    // Interval tracks: aliases merge keys that point to the same final track, and the tracks of
    // a process that share a name share a row (an unnamed one takes its first slice's name).
    const merged = new Map<string, { parts: Intervals[]; tid?: number; pid?: number; label: string }>();
    const rowOf = (key: string, iv?: Intervals) => {
      const k = this.resolve(key);
      const meta = this.meta.get(k) ?? {};
      const tid = k.startsWith("t:") ? Number(k.slice(2)) : meta.tid;
      if (tid !== undefined) {
        const thread = this.threads.get(tid);
        return { row: `t:${tid}`, tid, pid: thread?.pid ?? meta.pid, label: `${thread?.name ?? ""} ${tid}`.trim() };
      }
      const label = meta.label || (iv ? this.names[iv.name[firstSlice(iv)] ?? -1] : "") || "";
      return { row: `n:${meta.pid ?? ""}:${label}`, tid, pid: meta.pid, label };
    };
    const keyRow = new Map<string, string>();
    for (const [key, iv] of this.intervals) {
      const { row, tid, pid, label } = rowOf(key, iv);
      keyRow.set(key, row);
      const into = merged.get(row);
      if (!into) merged.set(row, { parts: [iv], tid, pid, label });
      else if (tid === undefined) into.parts.push(iv); // laid out on its own, then packed
      else for (const f of ["ts", "dur", "name", "arg", "sid"] as const) for (const v of iv[f]) into.parts[0]![f].push(v);
    }
    // A thread that only ran (no slices of its own) still gets a row for its states.
    for (const tid of states.keys()) {
      if (merged.has(`t:${tid}`)) continue;
      const { row, pid, label } = rowOf(`t:${tid}`);
      merged.set(row, { parts: [emptyIntervals()], tid, pid, label });
    }
    // Flows: ids chain the slices that carry them, in time order.
    const ids = this.flowIds.sort((a, b) => a.ts - b.ts);
    const lastOf = new Map<string, number>();
    for (const f of ids) {
      const prev = lastOf.get(f.id);
      if (prev !== undefined) this.flowPairs.push([prev, f.sid]);
      if (f.end) lastOf.delete(f.id);
      else lastOf.set(f.id, f.sid);
    }
    const want = new Set<number>();
    for (const [a, b] of this.flowPairs) want.add(a).add(b);
    const found = new Map<number, SliceRef>();
    const nameCount = new Int32Array(this.names.length);
    let sliceCount = 0;
    const threadTracks: SliceTrack[] = [];
    const rowTrack = new Map<string, SliceTrack>();
    const others = [...merged].filter(([, m]) => m.tid === undefined).sort((a, b) => a[1].label.localeCompare(b[1].label));
    for (const [row, m] of [...others, ...[...merged].filter(([, x]) => x.tid !== undefined)]) {
      const track = buildSlices(m.parts, end, id++, m.label, nameCount, want, found);
      rowTrack.set(row, track);
      if (m.tid !== undefined) {
        track.tid = m.tid;
        const st = states.get(m.tid);
        if (st) track.states = st;
      }
      if (m.pid !== undefined) track.pid = m.pid;
      sliceCount += track.count;
      if (m.tid !== undefined) threadTracks.push(track);
      else if (m.pid !== undefined) group(`p:${m.pid}`, "", m.pid).tracks.push(track);
      else group("global", "").tracks.push(track);
    }
    threadTracks.sort((a, b) => a.tid! - b.tid!);
    for (const t of threadTracks) {
      if (t.pid !== undefined) group(`p:${t.pid}`, "", t.pid).tracks.push(t);
      else group("threads", "").tracks.push(t);
    }
    const flows: Flow[] = [];
    for (const [a, b] of this.flowPairs) {
      const from = found.get(a);
      const to = found.get(b);
      if (from && to) flows.push({ from, to });
    }
    this.pointFlows(flows, (key) => rowTrack.get(keyRow.get(key) ?? rowOf(key).row));
    // Counters, then threads, then the process's other tracks.
    const rank = (t: Track) => (t.kind === "counter" ? 0 : t.kind === "slices" && t.tid !== undefined ? 1 : 2);
    for (const g of groups.values()) if (g !== cpuGroup) g.tracks.sort((a, b) => rank(a) - rank(b));
    const ordered: TrackGroup[] = [];
    if (cpuGroup.tracks.length) ordered.push(cpuGroup);
    const procs = [...groups.values()].filter((g) => g.pid !== undefined).sort((a, b) => a.pid! - b.pid!);
    for (const g of procs) {
      g.label = procLabel(g.pid!);
      ordered.push(g);
    }
    for (const k of ["threads", "global"]) {
      const g = groups.get(k);
      if (g?.tracks.length) ordered.push(g);
    }
    return {
      start, end, names: this.names, nameCount, args: this.args, groups: ordered,
      threads: this.threads, processes: this.processes, sliceCount, schedCount, flows,
    };
  }

  /** Flows bound by time (JSON s/t/f): each point takes the slice around it, then they chain. */
  private pointFlows(flows: Flow[], trackOf: (key: string) => SliceTrack | undefined): void {
    const pts = this.flowPoints;
    if (!pts.length) return;
    const order = [...pts.keys()].sort((a, b) => pts[a]!.ts - pts[b]!.ts || a - b);
    const open = new Map<string, SliceRef>();
    for (const i of order) {
      const p = pts[i]!;
      const tr = trackOf(p.track);
      const ref = tr ? (p.next ? nextSlice(tr, p.ts) : enclosingSlice(tr, p.ts)) : null;
      if (p.step === 0) open.delete(p.id);
      if (!ref) continue;
      const prev = open.get(p.id);
      if (prev && (prev.track !== ref.track || prev.level !== ref.level || prev.index !== ref.index)) flows.push({ from: prev, to: ref });
      if (p.step === 2) open.delete(p.id);
      else open.set(p.id, ref);
    }
  }

  /** Per-thread states from the CPU switches (who ran, how it left) and the wakeups. */
  private buildStates(end: number): Map<number, ThreadStates> {
    const ev = new Map<number, { ts: number[]; st: number[]; cpu: number[] }>();
    const push = (tid: number, ts: number, st: number, cpu: number) => {
      let e = ev.get(tid);
      if (!e) ev.set(tid, (e = { ts: [], st: [], cpu: [] }));
      e.ts.push(ts);
      e.st.push(st);
      e.cpu.push(cpu);
    };
    for (const [cpu, s] of this.sched) {
      const order = sortedOrder(s.ts);
      let cur = 0;
      for (let k = 0; k < s.ts.length; k++) {
        const i = order ? order[k]! : k;
        const tid = s.tid[i]!;
        const ts = s.ts[i]!;
        if (tid === cur) continue;
        if (cur > 0) push(cur, ts, s.prev[i]! >= 0 ? s.prev[i]! : ThreadState.Unknown, -1);
        if (tid > 0) push(tid, ts, ThreadState.Running, cpu);
        cur = tid;
      }
    }
    if (!ev.size) return new Map();
    const WAKE = 255;
    for (let i = 0; i < this.wakes.ts.length; i++) {
      const tid = this.wakes.tid[i]!;
      if (ev.has(tid)) push(tid, this.wakes.ts[i]!, WAKE, -1);
    }
    // At one instant: a wakeup, then leaving a CPU, then starting to run.
    const rank = (st: number) => (st === WAKE ? 0 : st === ThreadState.Running ? 2 : 1);
    const out = new Map<number, ThreadStates>();
    for (const [tid, e] of ev) {
      const n = e.ts.length;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      idx.sort((a, b) => e.ts[a]! - e.ts[b]! || rank(e.st[a]!) - rank(e.st[b]!) || a - b);
      const ts: number[] = [];
      const dur: number[] = [];
      const st: number[] = [];
      const cpus: number[] = [];
      let cur = -1;
      let from = 0;
      let onCpu = -1;
      const close = (at: number) => {
        if (cur < 0 || cur === ThreadState.Unknown || at <= from) return;
        const last = st.length - 1;
        if (last >= 0 && st[last] === cur && cpus[last] === onCpu && ts[last]! + dur[last]! === from) dur[last] = at - ts[last]!;
        else {
          ts.push(from);
          dur.push(at - from);
          st.push(cur);
          cpus.push(onCpu);
        }
      };
      for (let k = 0; k < n; k++) {
        const i = idx[k]!;
        let next = e.st[i]!;
        if (next === WAKE) {
          if (cur === ThreadState.Running || cur === ThreadState.Runnable) continue;
          next = ThreadState.Runnable;
        }
        close(e.ts[i]!);
        cur = next;
        from = e.ts[i]!;
        onCpu = next === ThreadState.Running ? e.cpu[i]! : -1;
      }
      if (cur !== ThreadState.Dead) close(end);
      if (!ts.length) continue;
      out.set(tid, { ts: Float64Array.from(ts), dur: Float64Array.from(dur), state: Uint8Array.from(st), cpu: Int16Array.from(cpus) });
    }
    return out;
  }

  private applyBeginEnd(end: number): void {
    const b = this.be;
    const n = b.ts.length;
    if (!n) return;
    const order = sortedOrder(b.ts);
    const open = new Map<string, number[]>(); // match key -> stack of be indices
    for (let k = 0; k < n; k++) {
      const i = order ? order[k]! : k;
      const match = b.match[i]!;
      if (b.kind[i] === 1) {
        let st = open.get(match);
        if (!st) open.set(match, (st = []));
        st.push(i);
      } else {
        const st = open.get(match);
        const j = st?.pop();
        if (j === undefined) continue;
        let arg = b.arg[j]!;
        if (b.tt[j]! >= 0 && b.tt[i]! >= b.tt[j]!) {
          const line = `thread_duration_us: ${b.tt[i]! - b.tt[j]!}`;
          if (arg >= 0) this.args[arg] += `\n${line}`;
          else arg = this.arg(line);
        }
        this.slice(b.track[j]!, b.ts[j]!, Math.max(0, b.ts[i]! - b.ts[j]!), b.name[j]!, arg, b.sid[j]!);
      }
    }
    // Slices still open at the end of the trace run to its end.
    for (const st of open.values()) for (const j of st) this.slice(b.track[j]!, b.ts[j]!, Math.max(0, end - b.ts[j]!), b.name[j]!, b.arg[j]!, b.sid[j]!);
    this.be = { ts: [], kind: [], match: [], track: [], name: [], arg: [], sid: [], tt: [] };
  }
}

/** The earliest slice (the longest at a tie): an unnamed track is named after it. */
function firstSlice(iv: Intervals): number {
  let best = -1;
  for (let i = 0; i < iv.ts.length; i++) {
    if (best < 0 || iv.ts[i]! < iv.ts[best]! || (iv.ts[i] === iv.ts[best] && iv.dur[i]! > iv.dur[best]!)) best = i;
  }
  return best;
}

/** Indices that sort `ts` ascending (stable), or null when it already is sorted. */
export function sortedOrder(ts: ArrayLike<number>): Uint32Array | null {
  let sorted = true;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! < ts[i - 1]!) {
      sorted = false;
      break;
    }
  }
  if (sorted) return null;
  const idx = new Uint32Array(ts.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return idx.sort((a, b) => ts[a]! - ts[b]! || a - b);
}

function buildCpu(s: { ts: number[]; tid: number[]; prev: number[] }, end: number, id: number, cpu: number): CpuTrack {
  const order = sortedOrder(s.ts);
  const n = s.ts.length;
  const ts: number[] = [];
  const dur: number[] = [];
  const tid: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = order ? order[k]! : k;
    const who = s.tid[i]!;
    if (who === 0) continue; // idle: a gap
    const next = k + 1 < n ? s.ts[order ? order[k + 1]! : k + 1]! : end;
    ts.push(s.ts[i]!);
    dur.push(Math.max(0, next - s.ts[i]!));
    tid.push(who);
  }
  return {
    kind: "cpu", id, cpu, label: `CPU ${cpu}`,
    ts: Float64Array.from(ts), dur: Float64Array.from(dur), tid: Int32Array.from(tid), count: ts.length,
  };
}

function buildCounter(c: { ts: number[]; val: number[] }, id: number, label: string, pid?: number): CounterTrack {
  const order = sortedOrder(c.ts);
  const n = c.ts.length;
  const ts = new Float64Array(n);
  const val = new Float64Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = order ? order[k]! : k;
    ts[k] = c.ts[i]!;
    const v = c.val[i]!;
    val[k] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const t: CounterTrack = { kind: "counter", id, label, ts, val, min: n ? min : 0, max: n ? max : 0 };
  if (pid !== undefined) t.pid = pid;
  return t;
}

const levelEnd = (lv: Intervals | undefined): number => {
  const n = lv ? lv.ts.length : 0;
  return n ? lv!.ts[n - 1]! + lv!.dur[n - 1]! : -Infinity;
};

type Ref = [sid: number, level: number, index: number];

/** Nests intervals into levels: longest first at equal starts, each on the first level it fits. */
function nest(iv: Intervals, end: number, nameCount: Int32Array, want: Set<number>): { levels: Intervals[]; refs: Ref[]; lo: number; hi: number } {
  const refs: Ref[] = [];
  const n = iv.ts.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => iv.ts[a]! - iv.ts[b]! || iv.dur[b]! - iv.dur[a]! || a - b);
  const levels: Intervals[] = [];
  const stack: number[] = []; // end time of the open slice on each level
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = idx[k]!;
    const ts = iv.ts[i]!;
    let dur = iv.dur[i]!;
    if (dur < 0) dur = Math.max(0, end - ts);
    if (ts < lo) lo = ts;
    if (ts + dur > hi) hi = ts + dur;
    while (stack.length && stack[stack.length - 1]! <= ts) stack.pop();
    let depth = stack.length;
    // A slice that overflows its parent is not nested in it (async tracks overlap freely): it
    // goes on the first level below the open ones that is free by then, and parents nothing.
    const nested = depth === 0 || ts + dur <= stack[depth - 1]!;
    const open = depth;
    while (depth < levels.length && levelEnd(levels[depth]) > ts) depth++;
    if (depth > 255) depth = 255;
    let lv = levels[depth];
    if (!lv) levels[depth] = lv = emptyIntervals();
    const last = lv.ts.length - 1;
    // Same level, still overlapping the previous one (zero-length cases): nudge to its end.
    let start = ts;
    if (last >= 0 && lv.ts[last]! + lv.dur[last]! > start) start = lv.ts[last]! + lv.dur[last]!;
    if (want.size && want.has(iv.sid[i]!)) refs.push([iv.sid[i]!, depth, lv.ts.length]);
    lv.ts.push(start);
    lv.dur.push(Math.max(0, ts + dur - start));
    lv.name.push(iv.name[i]!);
    lv.arg.push(iv.arg[i]!);
    if (iv.name[i]! >= 0) nameCount[iv.name[i]!]!++;
    if (nested && depth < 255) {
      // Levels skipped over hold overlapping slices that still run: they count as open.
      for (let d = open; d < depth; d++) stack[d] = levelEnd(levels[d]);
      stack[depth] = ts + dur;
      stack.length = depth + 1;
    }
  }
  for (let d = 0; d < levels.length; d++) levels[d] ??= emptyIntervals();
  return { levels, refs, lo, hi };
}

/**
 * A row's slices: one track nested as is; several tracks sharing a row (async tracks of one
 * name) each nested on their own, then packed as blocks on the first levels free over their span.
 */
function buildSlices(parts: Intervals[], end: number, id: number, label: string, nameCount: Int32Array, want: Set<number>, found: Map<number, SliceRef>): SliceTrack {
  let levels: Intervals[];
  let refs: Ref[];
  let count = 0;
  for (const p of parts) count += p.ts.length;
  if (parts.length === 1) ({ levels, refs } = nest(parts[0]!, end, nameCount, want));
  else {
    const built = parts.map((p) => nest(p, end, nameCount, want)).filter((b) => b.levels.length);
    built.sort((a, b) => a.lo - b.lo || b.hi - a.hi);
    levels = [];
    refs = [];
    const busy: number[] = [];
    for (const b of built) {
      const depth = b.levels.length;
      let o = 0;
      for (; o + depth <= 256; o++) {
        let free = true;
        for (let d = 0; d < depth && free; d++) if ((busy[o + d] ?? -Infinity) > b.lo) free = false;
        if (free) break;
      }
      o = Math.min(o, Math.max(0, 256 - depth));
      const base: number[] = [];
      for (let d = 0; d < depth; d++) {
        const into = (levels[o + d] ??= emptyIntervals());
        const from = b.levels[d]!;
        base.push(into.ts.length);
        // Past the level cap a block can overlap what is there: it starts after it instead.
        const after = levelEnd(into);
        for (let i = 0; i < from.ts.length; i++) {
          const t = Math.max(from.ts[i]!, after);
          into.ts.push(t);
          into.dur.push(Math.max(0, from.ts[i]! + from.dur[i]! - t));
          into.name.push(from.name[i]!);
          into.arg.push(from.arg[i]!);
        }
        busy[o + d] = Math.max(busy[o + d] ?? -Infinity, b.hi);
      }
      for (const [sid, d, i] of b.refs) refs.push([sid, o + d, base[d]! + i]);
    }
    for (let d = 0; d < levels.length; d++) levels[d] ??= emptyIntervals();
  }
  const track: SliceTrack = {
    kind: "slices", id, label, count,
    levels: levels.map((l) => ({
      ts: Float64Array.from(l.ts), dur: Float64Array.from(l.dur),
      name: Int32Array.from(l.name), arg: Int32Array.from(l.arg),
    })),
  };
  for (const [sid, level, index] of refs) found.set(sid, { track, level, index });
  return track;
}

/** The deepest slice of a track that spans `ts`. */
export function enclosingSlice(track: SliceTrack, ts: number): SliceRef | null {
  for (let d = track.levels.length - 1; d >= 0; d--) {
    const lv = track.levels[d]!;
    let lo = 0;
    let hi = lv.ts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (lv.ts[mid]! <= ts) lo = mid + 1;
      else hi = mid;
    }
    const i = lo - 1;
    if (i >= 0 && lv.ts[i]! + lv.dur[i]! >= ts) return { track, level: d, index: i };
  }
  return null;
}

/** The first slice of a track to start at or after `ts` (the shallowest one at a tie). */
export function nextSlice(track: SliceTrack, ts: number): SliceRef | null {
  let best: SliceRef | null = null;
  let bestTs = Infinity;
  track.levels.forEach((lv, d) => {
    let lo = 0;
    let hi = lv.ts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (lv.ts[mid]! < ts) lo = mid + 1;
      else hi = mid;
    }
    if (lo < lv.ts.length && lv.ts[lo]! < bestTs) {
      bestTs = lv.ts[lo]!;
      best = { track, level: d, index: lo };
    }
  });
  return best;
}
