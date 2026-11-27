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

export interface SliceTrack {
  kind: "slices";
  id: number;
  label: string;
  tid?: number;
  pid?: number;
  levels: SliceLevel[];
  count: number;
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
}

interface Intervals {
  ts: number[];
  dur: number[];
  name: number[];
  arg: number[];
}

interface TrackMeta {
  label?: string;
  tid?: number;
  pid?: number;
}

const emptyIntervals = (): Intervals => ({ ts: [], dur: [], name: [], arg: [] });

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
  private sched = new Map<number, { ts: number[]; tid: number[] }>();
  private counters = new Map<string, { ts: number[]; val: number[]; meta: TrackMeta; cpu?: number }>();
  // Begin/end events are applied in time order at the end, whatever order they arrived in.
  private be = { ts: [] as number[], kind: [] as number[], match: [] as string[], track: [] as string[], name: [] as number[], arg: [] as number[] };
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

  slice(track: string, ts: number, dur: number, name: number, arg = -1): void {
    let iv = this.intervals.get(track);
    if (!iv) this.intervals.set(track, (iv = emptyIntervals()));
    iv.ts.push(ts);
    iv.dur.push(dur);
    iv.name.push(name);
    iv.arg.push(arg);
    this.time(ts);
    if (dur > 0) this.time(ts + dur);
  }

  begin(match: string, track: string, ts: number, name: number, arg = -1): void {
    this.pushBE(1, match, track, ts, name, arg);
  }

  end(match: string, ts: number): void {
    this.pushBE(2, match, "", ts, -1, -1);
  }

  private pushBE(kind: number, match: string, track: string, ts: number, name: number, arg: number): void {
    const b = this.be;
    b.ts.push(ts);
    b.kind.push(kind);
    b.match.push(match);
    b.track.push(track);
    b.name.push(name);
    b.arg.push(arg);
    this.time(ts);
  }

  /** CPU `cpu` switches to thread `tid` at `ts` (0 is the idle task). */
  switchTo(cpu: number, ts: number, tid: number): void {
    let s = this.sched.get(cpu);
    if (!s) this.sched.set(cpu, (s = { ts: [], tid: [] }));
    s.ts.push(ts);
    s.tid.push(tid);
    this.time(ts);
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
    const merged = new Map<string, { iv: Intervals; tid?: number; pid?: number; label: string }>();
    for (const [key, iv] of this.intervals) {
      const k = this.resolve(key);
      const meta = this.meta.get(k) ?? {};
      const tid = k.startsWith("t:") ? Number(k.slice(2)) : meta.tid;
      let row: string;
      let pid: number | undefined;
      let label: string;
      if (tid !== undefined) {
        const thread = this.threads.get(tid);
        pid = thread?.pid ?? meta.pid;
        label = `${thread?.name ?? ""} ${tid}`.trim();
        row = `t:${tid}`;
      } else {
        pid = meta.pid;
        label = meta.label || this.names[iv.name[0] ?? -1] || "";
        row = `n:${pid ?? ""}:${label}`;
      }
      const into = merged.get(row);
      if (!into) merged.set(row, { iv, tid, pid, label });
      else for (const f of ["ts", "dur", "name", "arg"] as const) for (const v of iv[f]) into.iv[f].push(v);
    }
    const nameCount = new Int32Array(this.names.length);
    let sliceCount = 0;
    const threadTracks: SliceTrack[] = [];
    const others = [...merged.values()].filter((m) => m.tid === undefined).sort((a, b) => a.label.localeCompare(b.label));
    for (const m of [...others, ...[...merged.values()].filter((x) => x.tid !== undefined)]) {
      const track = buildSlices(m.iv, end, id++, m.label, nameCount);
      if (m.tid !== undefined) track.tid = m.tid;
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
      threads: this.threads, processes: this.processes, sliceCount, schedCount,
    };
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
        if (j !== undefined) this.slice(b.track[j]!, b.ts[j]!, Math.max(0, b.ts[i]! - b.ts[j]!), b.name[j]!, b.arg[j]!);
      }
    }
    // Slices still open at the end of the trace run to its end.
    for (const st of open.values()) for (const j of st) this.slice(b.track[j]!, b.ts[j]!, Math.max(0, end - b.ts[j]!), b.name[j]!, b.arg[j]!);
    this.be = { ts: [], kind: [], match: [], track: [], name: [], arg: [] };
  }
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

function buildCpu(s: { ts: number[]; tid: number[] }, end: number, id: number, cpu: number): CpuTrack {
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

/** Nests intervals into levels: longest first at equal starts, each on the first level it fits. */
function buildSlices(iv: Intervals, end: number, id: number, label: string, nameCount: Int32Array): SliceTrack {
  const n = iv.ts.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => iv.ts[a]! - iv.ts[b]! || iv.dur[b]! - iv.dur[a]! || a - b);
  const levels: Intervals[] = [];
  const stack: number[] = []; // end time of the open slice on each level
  for (let k = 0; k < n; k++) {
    const i = idx[k]!;
    const ts = iv.ts[i]!;
    let dur = iv.dur[i]!;
    if (dur < 0) dur = Math.max(0, end - ts);
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
  return {
    kind: "slices", id, label, count: n,
    levels: levels.map((l) => ({
      ts: Float64Array.from(l?.ts ?? []), dur: Float64Array.from(l?.dur ?? []),
      name: Int32Array.from(l?.name ?? []), arg: Int32Array.from(l?.arg ?? []),
    })),
  };
}
