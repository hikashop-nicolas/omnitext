// The model every profile reader fills: interned frames, a prefix tree of stacks (root first),
// and weighted samples tagged with a thread and, when known, a time. Views aggregate from it.

export interface Frame {
  name: string;
  /** Library, binary, script or file the frame lives in. */
  module: string;
  /** Category or language, for colouring: "JavaScript", "Kernel", "Java"... ("" when unknown). */
  category: string;
  file?: string;
  line?: number;
}

export interface ProfileThread {
  name: string;
  tid?: number | string;
  pid?: number | string;
  /** The process name, to group threads. */
  process?: string;
}

/** One kind of value samples carry: "samples", "cpu" in "nanoseconds", "alloc_space" in "bytes"... */
export interface ValueType {
  type: string;
  unit: string;
  /** How to name it: a translated label, or the event in `type` with a translated suffix. */
  label?: "samples" | "time" | "bytes" | "weight" | "period" | "events";
}

/** Per-sample labels (pprof's), one value column per key: an index into `strings`, or -1. */
export interface SampleLabels {
  keys: string[];
  values: Int32Array[];
  strings: string[];
}

export interface Marker {
  name: string;
  /** ns from the profile's start. */
  start: number;
  /** ns, 0 for an instant. */
  dur: number;
  category: string;
  thread: number;
  detail: string;
}

export interface Profile {
  frames: Frame[];
  /** Parent stack of each stack, -1 at a root. A parent always has a lower index. */
  stackParent: Int32Array;
  stackFrame: Int32Array;
  sampleStack: Int32Array;
  sampleThread: Int32Array;
  /** ns from the profile's start, or null when samples carry no time. */
  sampleTime: Float64Array | null;
  /** One weight per sample for each value type. */
  values: Float64Array[];
  valueTypes: ValueType[];
  defaultValue: number;
  threads: ProfileThread[];
  markers: Marker[];
  /** Reader remarks: skipped lines, lost samples. */
  notes: string[];
  labels?: SampleLabels;
  /** Wall clock of the start, ms since 1970, when known. */
  startedAt?: number;
  /** Profile duration in ns, when known. */
  duration?: number;
}

const grow = <T extends Int32Array | Float64Array>(a: T, n: number): T => {
  if (n <= a.length) return a;
  const b = new (a.constructor as { new (n: number): T })(Math.max(n, a.length * 2));
  b.set(a);
  return b;
};

/** Interns frames and stacks and collects samples, for every reader. */
export class ProfileBuilder {
  private frames: Frame[] = [];
  private frameIds = new Map<string, number>();
  private stackParent = new Int32Array(1024);
  private stackFrame = new Int32Array(1024);
  private stackCount = 0;
  private stackIds = new Map<number, number>();
  private sStack = new Int32Array(1024);
  private sThread = new Int32Array(1024);
  private sTime = new Float64Array(1024);
  private sValues: Float64Array[];
  private n = 0;
  private timed = true;
  readonly threads: ProfileThread[] = [];
  private threadIds = new Map<string, number>();
  readonly markers: Marker[] = [];
  readonly notes: string[] = [];

  constructor(readonly valueTypes: ValueType[] = [{ type: "samples", unit: "count", label: "samples" }]) {
    this.sValues = valueTypes.map(() => new Float64Array(1024));
  }

  frame(name: string, module = "", category = "", file?: string, line?: number): number {
    const key = `${name}\u0000${module}\u0000${category}\u0000${file ?? ""}`;
    let id = this.frameIds.get(key);
    if (id === undefined) {
      id = this.frames.length;
      const f: Frame = { name, module, category };
      if (file) f.file = file;
      if (line !== undefined && line > 0) f.line = line;
      this.frames.push(f);
      this.frameIds.set(key, id);
    }
    return id;
  }

  /** The stack made of `parent` (-1 for none) with `frame` on top. */
  stack(parent: number, frame: number): number {
    // One numeric key per (frame, parent): exact while both stay under 2^21 and 2^32.
    const key = frame * 4294967296 + (parent + 1);
    const known = this.stackIds.get(key);
    if (known !== undefined) return known;
    const id = this.stackCount++;
    this.stackParent = grow(this.stackParent, this.stackCount);
    this.stackFrame = grow(this.stackFrame, this.stackCount);
    this.stackParent[id] = parent;
    this.stackFrame[id] = frame;
    this.stackIds.set(key, id);
    return id;
  }

  /** The stack of these frames, root first; -1 for an empty list. */
  stackOf(frames: ArrayLike<number>): number {
    let s = -1;
    for (let i = 0; i < frames.length; i++) s = this.stack(s, frames[i]!);
    return s;
  }

  thread(key: string, info: ProfileThread): number {
    let id = this.threadIds.get(key);
    if (id === undefined) {
      id = this.threads.length;
      this.threads.push(info);
      this.threadIds.set(key, id);
    }
    return id;
  }

  /** A sample of `stack` (-1: no frames, dropped). `values` holds one weight per value type, or one number for the first. */
  sample(stack: number, thread: number, values: number | ArrayLike<number>, time?: number): void {
    if (stack < 0) return;
    const i = this.n++;
    if (i >= this.sStack.length) {
      this.sStack = grow(this.sStack, i + 1);
      this.sThread = grow(this.sThread, i + 1);
      this.sTime = grow(this.sTime, i + 1);
      this.sValues = this.sValues.map((v) => grow(v, i + 1));
    }
    this.sStack[i] = stack;
    this.sThread[i] = thread;
    if (time === undefined || !Number.isFinite(time)) this.timed = false;
    else this.sTime[i] = time;
    if (typeof values === "number") this.sValues[0]![i] = values;
    else for (let k = 0; k < this.sValues.length; k++) this.sValues[k]![i] = values[k] ?? 0;
  }

  get sampleCount(): number {
    return this.n;
  }

  finish(extra: Partial<Pick<Profile, "defaultValue" | "startedAt" | "duration" | "labels">> = {}): Profile {
    const n = this.n;
    let time: Float64Array | null = null;
    if (this.timed && n > 0) {
      time = this.sTime.slice(0, n);
      // Times start at zero.
      let min = Infinity;
      for (let i = 0; i < n; i++) if (time[i]! < min) min = time[i]!;
      if (min !== 0) {
        for (let i = 0; i < n; i++) time[i] = time[i]! - min;
        for (const m of this.markers) m.start -= min;
      }
    }
    if (!this.threads.length) this.threads.push({ name: "" });
    return {
      frames: this.frames,
      stackParent: this.stackParent.slice(0, this.stackCount),
      stackFrame: this.stackFrame.slice(0, this.stackCount),
      sampleStack: this.sStack.slice(0, n),
      sampleThread: this.sThread.slice(0, n),
      sampleTime: time,
      values: this.sValues.map((v) => v.slice(0, n)),
      valueTypes: this.valueTypes,
      defaultValue: extra.defaultValue ?? 0,
      threads: this.threads,
      markers: this.markers,
      notes: this.notes,
      ...(extra.startedAt !== undefined ? { startedAt: extra.startedAt } : {}),
      ...(extra.duration !== undefined ? { duration: extra.duration } : {}),
      ...(extra.labels ? { labels: extra.labels } : {}),
    };
  }
}

/** The profile with its samples grouped by a label's values instead of by thread. */
export function groupByLabel(p: Profile, key: number, none: string): Profile {
  const L = p.labels;
  if (!L || !L.values[key]) return p;
  const col = L.values[key]!;
  const ids = new Map<number, number>();
  const threads: ProfileThread[] = [];
  const sampleThread = new Int32Array(col.length);
  for (let i = 0; i < col.length; i++) {
    const v = col[i]!;
    let id = ids.get(v);
    if (id === undefined) {
      id = threads.length;
      ids.set(v, id);
      threads.push({ name: v >= 0 ? L.strings[v]! : none });
    }
    sampleThread[i] = id;
  }
  return { ...p, threads, sampleThread };
}

// --- aggregation ------------------------------------------------------------------------------

/** Which samples count: a set of threads (null: all), a value type, and a time range. */
export interface SampleFilter {
  threads: Set<number> | null;
  value: number;
  /** ns, inclusive; NaN for no bound. */
  from?: number;
  to?: number;
}

/** Summed weight per stack for the samples the filter keeps. */
export function stackWeights(p: Profile, f: SampleFilter): Float64Array {
  const w = new Float64Array(p.stackFrame.length);
  const vals = p.values[f.value] ?? p.values[0]!;
  const time = p.sampleTime;
  const from = f.from ?? NaN;
  const to = f.to ?? NaN;
  const useTime = time && (!Number.isNaN(from) || !Number.isNaN(to));
  for (let i = 0; i < p.sampleStack.length; i++) {
    if (f.threads && !f.threads.has(p.sampleThread[i]!)) continue;
    if (useTime) {
      const t = time[i]!;
      if (t < from || t > to) continue;
    }
    w[p.sampleStack[i]!] += vals[i]!;
  }
  return w;
}

/** A call tree: node 0 is a synthetic root holding everything. */
export interface CallTree {
  frame: Int32Array;
  parent: Int32Array;
  depth: Int32Array;
  total: Float64Array;
  self: Float64Array;
  /** Children of each node, heaviest first. */
  children: Int32Array[];
  /** Start of each node along the root's width (heaviest child leftmost). */
  x: Float64Array;
  maxDepth: number;
  inverted: boolean;
}

class TreeBuilder {
  frame: number[] = [-1];
  parent: number[] = [-1];
  depth: number[] = [0];
  total: number[] = [0];
  self: number[] = [0];
  private ids = new Map<number, number>();

  child(node: number, frame: number): number {
    const key = frame * 4294967296 + node;
    let c = this.ids.get(key);
    if (c === undefined) {
      c = this.frame.length;
      this.frame.push(frame);
      this.parent.push(node);
      this.depth.push(this.depth[node]! + 1);
      this.total.push(0);
      this.self.push(0);
      this.ids.set(key, c);
    }
    return c;
  }

  finish(inverted: boolean): CallTree {
    const n = this.frame.length;
    const total = Float64Array.from(this.total);
    // Children from the parent links, heaviest first; empty nodes are left out.
    const count = new Int32Array(n);
    for (let i = 1; i < n; i++) if (total[i]! > 0) count[this.parent[i]!]++;
    const children: Int32Array[] = new Array(n);
    for (let i = 0; i < n; i++) children[i] = new Int32Array(count[i]!);
    const fill = new Int32Array(n);
    let maxDepth = 0;
    for (let i = 1; i < n; i++) {
      if (!(total[i]! > 0)) continue;
      const p = this.parent[i]!;
      children[p]![fill[p]!++] = i;
      if (this.depth[i]! > maxDepth) maxDepth = this.depth[i]!;
    }
    for (const kids of children) if (kids.length > 1) kids.sort((a, b) => total[b]! - total[a]! || a - b);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let at = x[i]!;
      for (const c of children[i]!) {
        x[c] = at;
        at += total[c]!;
      }
    }
    return {
      frame: Int32Array.from(this.frame),
      parent: Int32Array.from(this.parent),
      depth: Int32Array.from(this.depth),
      total,
      self: Float64Array.from(this.self),
      children,
      x,
      maxDepth,
      inverted,
    };
  }
}

/**
 * The call tree of the weighted stacks: top-down (callees under callers), or inverted (each
 * function that had self time at the top, its callers under it).
 */
export function callTree(p: Profile, weights: Float64Array, inverted = false): CallTree {
  const b = new TreeBuilder();
  const S = p.stackFrame.length;
  if (!inverted) {
    const node = new Int32Array(S);
    for (let s = 0; s < S; s++) {
      const parent = p.stackParent[s]!;
      node[s] = b.child(parent < 0 ? 0 : node[parent]!, p.stackFrame[s]!);
    }
    for (let s = 0; s < S; s++) b.self[node[s]!] += weights[s]!;
    for (let i = b.frame.length - 1; i > 0; i--) {
      b.total[i] += b.self[i]!;
      b.total[b.parent[i]!] += b.total[i]!;
    }
    return b.finish(false);
  }
  for (let s = 0; s < S; s++) {
    const w = weights[s]!;
    if (!w) continue;
    let node = 0;
    b.total[0] += w;
    for (let at = s; at >= 0; at = p.stackParent[at]!) {
      node = b.child(node, p.stackFrame[at]!);
      b.total[node] += w;
      if (at === s) b.self[node] += w;
    }
  }
  return b.finish(true);
}

/** Self and total weight of every frame; recursion counts once per sample toward total. */
export function frameTotals(p: Profile, weights: Float64Array): { self: Float64Array; total: Float64Array } {
  const F = p.frames.length;
  const self = new Float64Array(F);
  const total = new Float64Array(F);
  const seen = new Int32Array(F).fill(-1);
  for (let s = 0; s < weights.length; s++) {
    const w = weights[s]!;
    if (!w) continue;
    self[p.stackFrame[s]!] += w;
    for (let at = s; at >= 0; at = p.stackParent[at]!) {
      const f = p.stackFrame[at]!;
      if (seen[f] === s) continue;
      seen[f] = s;
      total[f] += w;
    }
  }
  return { self, total };
}

/** The frames that call `frame` (its outermost call in each stack), with the weight through each. */
export function callersOf(p: Profile, weights: Float64Array, frame: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let s = 0; s < weights.length; s++) {
    const w = weights[s]!;
    if (!w) continue;
    let caller = -2;
    for (let at = s; at >= 0; at = p.stackParent[at]!) {
      if (p.stackFrame[at] !== frame) continue;
      const up = p.stackParent[at]!;
      caller = up < 0 ? -1 : p.stackFrame[up]!;
    }
    if (caller !== -2) out.set(caller, (out.get(caller) ?? 0) + w);
  }
  return out;
}

/** Weight per column of time, for the samples-over-time strip. */
export function timeHistogram(p: Profile, f: SampleFilter, columns: number, span: number): Float64Array {
  const out = new Float64Array(columns);
  const time = p.sampleTime;
  if (!time || span <= 0) return out;
  const vals = p.values[f.value] ?? p.values[0]!;
  for (let i = 0; i < time.length; i++) {
    if (f.threads && !f.threads.has(p.sampleThread[i]!)) continue;
    const c = Math.min(columns - 1, Math.max(0, Math.floor((time[i]! / span) * columns)));
    out[c] += vals[i]!;
  }
  return out;
}

/** Weight of every thread for one value type, to order and label the thread list. */
export function threadTotals(p: Profile, value: number): Float64Array {
  const out = new Float64Array(p.threads.length);
  const vals = p.values[value] ?? p.values[0]!;
  for (let i = 0; i < p.sampleThread.length; i++) out[p.sampleThread[i]!] += vals[i]!;
  return out;
}

/** End of the sampled time, in ns. */
export function profileSpan(p: Profile): number {
  if (!p.sampleTime) return 0;
  let max = 0;
  for (const t of p.sampleTime) if (t > max) max = t;
  return Math.max(max, p.duration ?? 0);
}

/** Last path component of a module path or URL, for display. */
export function baseName(path: string): string {
  const clean = path.replace(/[?#].*$/, "").replace(/[/\\]+$/, "");
  const i = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return i >= 0 ? clean.slice(i + 1) || path : clean;
}

/** A category guessed from a frame's module and name, for formats that name none. */
export function guessCategory(name: string, module: string): string {
  const m = module.toLowerCase();
  if (/\[kernel|vmlinux|kallsyms|\.ko$/.test(m) || /_\[k\]$/.test(name)) return "Kernel";
  if (/\.(?:oat|odex|vdex|dex|jar|apk)$|^\[jit|jit-cache|dalvik|boot.*\.art$|\.class$/.test(m) || /_\[j\]$/.test(name)) return "Java";
  if (/\.(?:m?js|cjs|jsx|ts|tsx|vue)(?:$|[?#:])|^https?:|^webpack:|^file:.*\.js/.test(m)) return "JavaScript";
  if (/\.py[cdo]?$/.test(m)) return "Python";
  if (/\.go$/.test(m)) return "Go";
  if (/\.rb$/.test(m)) return "Ruby";
  if (/\.php$/.test(m)) return "PHP";
  if (/\.(?:dll|cs)$/.test(m) || /^System\.|^Microsoft\./.test(name)) return /\.dll$/.test(m) && !/^System\.|^Microsoft\./.test(name) ? "Native" : ".NET";
  if (/^\[unknown\]$|^$/.test(m)) return "";
  if (/\.(?:so(?:\.\d+)*|dylib|exe|a)$|^\/(?:usr|lib|system|apex|bin|vendor)\//.test(m) || /^[^.]+$/.test(baseName(m))) return "Native";
  return "";
}

/** "foo+0x1a" or "foo+26" to "foo", as perf and simpleperf print offsets. */
export const stripOffset = (sym: string): string => sym.replace(/\+(?:0x[0-9a-f]+|\d+)$/i, "");
