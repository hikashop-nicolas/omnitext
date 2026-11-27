import { ProfileBuilder, baseName, guessCategory, type Profile } from "./profile-model";

// JSON profiles: Firefox Profiler (Gecko, from Firefox or samply, raw or processed), Chrome and
// Node .cpuprofile (and the CPU profile chunks of a Chrome trace), and speedscope files.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = NaN): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);
const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
/** Old Gecko profiles store some members as JSON strings. */
const parsed = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

// --- Firefox Profiler -------------------------------------------------------------------------

/** A table in either Gecko form: {schema, data} rows, or processed columns. */
interface Table {
  length: number;
  get(row: number, col: string): unknown;
  has(col: string): boolean;
}

function table(v: unknown): Table {
  const t = obj(parsed(v));
  if (!t) return { length: 0, get: () => undefined, has: () => false };
  const schema = obj(t.schema);
  if (schema) {
    const data = arr(t.data);
    return {
      length: data.length,
      get: (row, col) => {
        const r = data[row];
        const i = schema[col];
        if (typeof i !== "number") return undefined;
        return Array.isArray(r) ? r[i] : undefined;
      },
      has: (col) => typeof schema[col] === "number",
    };
  }
  const len = num(t.length, -1);
  const cols = t as Record<string, unknown>;
  let length = len;
  if (length < 0) for (const c of Object.values(cols)) if (Array.isArray(c)) length = Math.max(length, c.length);
  return {
    length: Math.max(0, length),
    get: (row, col) => (Array.isArray(cols[col]) ? (cols[col] as unknown[])[row] : undefined),
    has: (col) => Array.isArray(cols[col]),
  };
}

/** "func (in lib.so)", "func (http://x/a.js:12:3)", "0x1234" to name, module, file and line. */
function geckoLocation(loc: string): { name: string; module: string; file?: string; line?: number; js: boolean } {
  const lib = /^(.*) \(in ([^)]+)\)(?: \+ \d+)?$/.exec(loc);
  if (lib) return { name: lib[1]!, module: lib[2]!, js: false };
  const js = /^(.*?) ?\(?((?:https?|file|resource|chrome|moz-extension|webpack):[^\s()]*?)(?::(\d+))?(?::\d+)?\)?$/.exec(loc);
  if (js && js[2]) return { name: js[1] || baseName(js[2]), module: baseName(js[2]), file: js[2], ...(js[3] ? { line: Number(js[3]) } : {}), js: true };
  return { name: loc, module: "", js: false };
}

interface GeckoCtx {
  b: ProfileBuilder;
  categories: string[];
  libs: unknown[];
  shared: Json | null;
  /** ms of this (sub)profile's start, against the main profile's. */
  offset: number;
  weightTypes: Set<string>;
}

function readGeckoThread(ctx: GeckoCtx, raw: unknown, procName: string, procPid: string): void {
  const th = obj(parsed(raw));
  if (!th) return;
  const { b } = ctx;
  const shared = ctx.shared;
  const strings = arr(th.stringArray ?? th.stringTable ?? shared?.stringArray);
  const s = (i: unknown): string => {
    const k = num(i, -1);
    return k >= 0 ? str(strings[k]) : str(i);
  };
  const tid = th.tid ?? th.name;
  const pid = str(th.pid ?? procPid);
  const name = str(th.name) || `Thread ${str(tid)}`;
  const process = str(th.processName) || procName;
  const thread = b.thread(`${pid}:${str(tid)}:${b.threads.length}`, {
    name,
    ...(th.tid !== undefined ? { tid: th.tid as number | string } : {}),
    ...(pid ? { pid } : {}),
    ...(process ? { process } : {}),
  });
  const stackT = table(th.stackTable ?? shared?.stackTable);
  const frameT = table(th.frameTable ?? shared?.frameTable);
  const funcT = table(th.funcTable ?? shared?.funcTable);
  const resT = table(th.resourceTable ?? shared?.resourceTable);
  // Frames: processed profiles go through funcTable, raw ones name a location string.
  const frameIds = new Int32Array(frameT.length).fill(-1);
  const frameId = (f: number): number => {
    if (f < 0 || f >= frameT.length) return -1;
    if (frameIds[f]! >= 0) return frameIds[f]!;
    let name: string;
    let module = "";
    let file: string | undefined;
    let line = num(frameT.get(f, "line"), 0);
    let js = false;
    if (frameT.has("func")) {
      const fn = num(frameT.get(f, "func"), -1);
      name = s(funcT.get(fn, "name"));
      js = !!funcT.get(fn, "isJS");
      const fileName = funcT.get(fn, "fileName");
      if (fileName !== null && fileName !== undefined) file = s(fileName) || undefined;
      if (!line) line = num(funcT.get(fn, "lineNumber"), 0);
      const res = num(funcT.get(fn, "resource"), -1);
      if (res >= 0) {
        const lib = num(resT.get(res, "lib"), -1);
        const libInfo = lib >= 0 ? obj(ctx.libs[lib]) : null;
        module = libInfo ? str(libInfo.name) || baseName(str(libInfo.path)) : s(resT.get(res, "name"));
      }
      if (!module && file) module = baseName(file);
    } else {
      const loc = geckoLocation(s(frameT.get(f, "location")));
      name = loc.name;
      module = loc.module;
      file = loc.file;
      if (loc.line && !line) line = loc.line;
      js = loc.js;
    }
    const catIdx = frameT.get(f, "category");
    let category = typeof catIdx === "number" && Number.isInteger(catIdx) && ctx.categories[catIdx] !== undefined ? ctx.categories[catIdx]! : "";
    if (!category || category === "Other") category = js ? "JavaScript" : guessCategory(name, file ?? module) || category;
    return (frameIds[f] = b.frame(name || "?", module, category, file, line || undefined));
  };
  // Stacks: each row is a prefix plus a frame; parents come first.
  const stackIds = new Int32Array(stackT.length).fill(-1);
  const stackId = (st: number): number => {
    if (st < 0 || st >= stackT.length) return -1;
    if (stackIds[st]! >= 0) return stackIds[st]!;
    const chain: number[] = [];
    let at = st;
    while (at >= 0 && at < stackT.length && stackIds[at]! < 0 && chain.length < 100000) {
      chain.push(at);
      const p = stackT.get(at, "prefix");
      at = p === null || p === undefined ? -1 : num(p, -1);
    }
    let parent = at >= 0 && at < stackT.length ? stackIds[at]! : -1;
    for (let k = chain.length - 1; k >= 0; k--) {
      const row = chain[k]!;
      const f = frameId(num(stackT.get(row, "frame"), -1));
      parent = f < 0 ? parent : b.stack(parent, f);
      stackIds[row] = parent;
    }
    return parent;
  };
  const samples = table(th.samples);
  const weightType = str(obj(th.samples)?.weightType) || "samples";
  ctx.weightTypes.add(weightType);
  const hasDeltas = samples.has("timeDeltas");
  let t = 0;
  for (let i = 0; i < samples.length; i++) {
    t = hasDeltas ? t + num(samples.get(i, "timeDeltas"), 0) : num(samples.get(i, "time"), NaN);
    const raw = samples.get(i, "stack");
    if (raw === null || raw === undefined) continue;
    const st = stackId(num(raw, -1));
    const w = samples.has("weight") ? num(samples.get(i, "weight"), 1) : 1;
    b.sample(st, thread, w, (t + ctx.offset) * 1e6);
  }
  readGeckoMarkers(ctx, th.markers, s, thread);
}

function readGeckoMarkers(ctx: GeckoCtx, raw: unknown, s: (i: unknown) => string, thread: number): void {
  const m = table(raw);
  for (let i = 0; i < m.length && ctx.b.markers.length < 200000; i++) {
    const data = obj(m.get(i, "data"));
    let start = num(m.get(i, "startTime"), num(m.get(i, "time"), NaN));
    let end = num(m.get(i, "endTime"), NaN);
    const phase = num(m.get(i, "phase"), -1);
    if (phase === 0) end = start;
    else if (phase === 3 && Number.isNaN(start)) start = end;
    if (Number.isNaN(start) && data) start = num(data.startTime, NaN);
    if (Number.isNaN(end) && data) end = num(data.endTime, start);
    if (Number.isNaN(start)) continue;
    if (Number.isNaN(end) || end < start) end = start;
    const catIdx = m.get(i, "category");
    const category = typeof catIdx === "number" ? (ctx.categories[catIdx] ?? "") : str(data?.category ?? data?.type);
    const detail = data ? markerDetail(data) : "";
    ctx.b.markers.push({ name: s(m.get(i, "name")), start: (start + ctx.offset) * 1e6, dur: (end - start) * 1e6, category, thread, detail });
  }
}

/** A marker's payload as short "key: value" pairs, leaving out what is shown already. */
function markerDetail(data: Json): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (["type", "category", "startTime", "endTime", "stack", "cause", "interval"].includes(k)) continue;
    if (v === null || typeof v === "object") continue;
    out.push(`${k}: ${String(v)}`);
    if (out.length >= 8) break;
  }
  return out.join(", ");
}

function readGeckoProfile(b: ProfileBuilder, p: Json, offset: number, weightTypes: Set<string>, mainStart: number): void {
  const meta = obj(p.meta) ?? {};
  const categories = arr(meta.categories).map((c) => str(obj(c)?.name));
  const ctx: GeckoCtx = { b, categories, libs: arr(parsed(p.libs)), shared: obj(p.shared), offset, weightTypes };
  const procName = str(meta.product);
  for (const th of arr(parsed(p.threads))) readGeckoThread(ctx, th, procName, "");
  // Child processes of a raw Firefox profile, each with its own clock start.
  for (const sub of arr(p.processes)) {
    const sp = obj(parsed(sub));
    if (!sp) continue;
    const subStart = num(obj(sp.meta)?.startTime, mainStart);
    readGeckoProfile(b, sp, offset + (subStart - mainStart), weightTypes, mainStart);
  }
}

export function readGecko(text: string): Profile {
  let root = obj(JSON.parse(text));
  if (!root) throw new Error("not a profile");
  // Firefox's old DevTools recordings wrap the Gecko profile.
  if (!root.threads && obj(root.profile)) root = obj(root.profile)!;
  const b = new ProfileBuilder();
  const meta = obj(root.meta) ?? {};
  const start = num(meta.startTime, 0);
  const weightTypes = new Set<string>();
  readGeckoProfile(b, root, 0, weightTypes, start);
  const wt = weightTypes.size === 1 ? [...weightTypes][0]! : "samples";
  b.valueTypes[0] = wt === "tracing-ms" ? { type: "time", unit: "milliseconds", label: "time" } : wt === "bytes" ? { type: "bytes", unit: "bytes", label: "bytes" } : { type: "samples", unit: "count", label: "samples" };
  return b.finish(start ? { startedAt: start } : {});
}

// --- Chrome / V8 cpuprofile ---------------------------------------------------------------------

interface CpuNode {
  id: number;
  parent: number;
  callFrame: Json;
  hitCount: number;
}

const V8_SPECIAL: Record<string, string> = {
  "(program)": "Other",
  "(idle)": "Idle",
  "(garbage collector)": "GC",
  "(root)": "Other",
};

function cpuFrame(b: ProfileBuilder, cf: Json): number {
  const fn = str(cf.functionName);
  const url = str(cf.url);
  const name = fn || (url ? "(anonymous)" : "(anonymous)");
  const line = num(cf.lineNumber, -1);
  const special = V8_SPECIAL[fn];
  const codeType = str(cf.codeType);
  const category = special ?? (codeType === "other" && !url ? "Native" : url || codeType === "JS" ? "JavaScript" : guessCategory(fn, url) || "JavaScript");
  // Chrome's line numbers count from zero.
  return b.frame(name, url ? baseName(url) : "", category, url || undefined, line >= 0 ? line + 1 : undefined);
}

/** One CPU profile (nodes, samples, timeDeltas) into the builder, as thread `thread`. */
function addCpuProfile(b: ProfileBuilder, nodes: CpuNode[], samples: number[], deltas: number[], startUs: number, endUs: number, thread: number): void {
  const byId = new Map<number, CpuNode>();
  for (const n of nodes) byId.set(n.id, n);
  const stackOf = new Map<number, number>();
  const stack = (id: number): number => {
    const known = stackOf.get(id);
    if (known !== undefined) return known;
    const chain: CpuNode[] = [];
    let at = byId.get(id);
    while (at && !stackOf.has(at.id) && chain.length < 100000) {
      chain.push(at);
      at = at.parent >= 0 ? byId.get(at.parent) : undefined;
    }
    let parent = at ? stackOf.get(at.id)! : -1;
    for (let k = chain.length - 1; k >= 0; k--) {
      const n = chain[k]!;
      // The (root) node is not a function.
      if (n.parent >= 0 || str(n.callFrame.functionName) !== "(root)") parent = b.stack(parent, cpuFrame(b, n.callFrame));
      stackOf.set(n.id, parent);
    }
    return parent;
  };
  if (samples.length) {
    const times: number[] = new Array(samples.length);
    let t = startUs;
    for (let i = 0; i < samples.length; i++) {
      t += deltas[i] ?? 0;
      times[i] = t;
    }
    for (let i = 0; i < samples.length; i++) {
      // A sample lasts until the next one, as DevTools counts it.
      const next = i + 1 < samples.length ? times[i + 1]! : Math.max(endUs, times[i]!);
      const dur = Math.max(0, next - times[i]!) * 1000;
      b.sample(stack(samples[i]!), thread, [dur, 1], times[i]! * 1000);
    }
    return;
  }
  for (const n of nodes) if (n.hitCount > 0) b.sample(stack(n.id), thread, [0, n.hitCount]);
}

function cpuNodes(raw: unknown[], into: Map<number, CpuNode>): void {
  for (const r of raw) {
    const n = obj(r);
    if (!n) continue;
    const id = num(n.id, NaN);
    if (Number.isNaN(id)) continue;
    const node: CpuNode = into.get(id) ?? { id, parent: -1, callFrame: obj(n.callFrame) ?? {}, hitCount: 0 };
    if (n.parent !== undefined) node.parent = num(n.parent, -1);
    node.hitCount += num(n.hitCount, 0);
    into.set(id, node);
    for (const c of arr(n.children)) {
      const cid = num(c, NaN);
      if (Number.isNaN(cid)) continue;
      const child = into.get(cid);
      if (child) child.parent = id;
      else into.set(cid, { id: cid, parent: id, callFrame: {}, hitCount: 0 });
    }
  }
  // Children listed before their own entry got an empty frame: fill it in.
  for (const r of raw) {
    const n = obj(r);
    const node = n ? into.get(num(n.id, NaN)) : undefined;
    if (node && n && !Object.keys(node.callFrame).length) node.callFrame = obj(n.callFrame) ?? {};
  }
}

/** The old .cpuprofile shape: a nested tree under "head", call frame fields on each node. */
function flattenHead(head: unknown): Json[] {
  const out: Json[] = [];
  const todo: unknown[] = [head];
  while (todo.length && out.length < 1_000_000) {
    const n = obj(todo.pop());
    if (!n) continue;
    const kids = arr(n.children).map(obj).filter((k): k is Json => !!k);
    out.push({ id: n.id, hitCount: n.hitCount, callFrame: n, children: kids.map((k) => k.id) });
    todo.push(...kids);
  }
  return out;
}

export function readCpuProfile(text: string): Profile {
  const root = obj(JSON.parse(text));
  if (!root) throw new Error("not a profile");
  const b = new ProfileBuilder([
    { type: "time", unit: "nanoseconds", label: "time" },
    { type: "samples", unit: "count", label: "samples" },
  ]);
  const thread = b.thread("main", { name: "" });
  const nodes = new Map<number, CpuNode>();
  cpuNodes(root.head ? flattenHead(root.head) : arr(root.nodes), nodes);
  const samples = arr(root.samples).map((v) => num(v, -1));
  // Old profiles have absolute timestamps (and seconds for start and end) instead of deltas.
  const stamps = arr(root.timestamps).map((v) => num(v, 0));
  const old = !!root.head && stamps.length > 0;
  const start = old ? stamps[0]! : num(root.startTime, 0);
  const deltas = old ? stamps.map((t, i) => t - (i ? stamps[i - 1]! : start)) : arr(root.timeDeltas).map((v) => num(v, 0));
  if (old) root.endTime = stamps[stamps.length - 1]!;
  addCpuProfile(b, [...nodes.values()], samples, deltas, start, num(root.endTime, start), thread);
  return b.finish({ defaultValue: samples.length ? 0 : 1 });
}

/** The CPU profiles inside a Chrome trace (Profile and ProfileChunk events), one per thread. */
export function readChromeTraceProfiles(text: string): Profile {
  const root = JSON.parse(text) as unknown;
  const events = Array.isArray(root) ? root : arr(obj(root)?.traceEvents);
  const b = new ProfileBuilder([
    { type: "time", unit: "nanoseconds", label: "time" },
    { type: "samples", unit: "count", label: "samples" },
  ]);
  interface Acc {
    pid: number;
    tid: number;
    start: number;
    end: number;
    nodes: Map<number, CpuNode>;
    samples: number[];
    deltas: number[];
  }
  const profiles = new Map<string, Acc>();
  const names = new Map<string, string>();
  const procs = new Map<number, string>();
  for (const raw of events) {
    const e = obj(raw);
    if (!e) continue;
    const name = str(e.name);
    const pid = num(e.pid, 0);
    const tid = num(e.tid, 0);
    if (e.ph === "M") {
      const n = str(obj(e.args)?.name);
      if (name === "thread_name") names.set(`${pid}:${tid}`, n);
      else if (name === "process_name") procs.set(pid, n);
      continue;
    }
    if (name !== "Profile" && name !== "ProfileChunk" && name !== "CpuProfile") continue;
    const data = obj(obj(e.args)?.data);
    if (!data) continue;
    const key = `${pid}:${str(e.id)}`;
    let acc = profiles.get(key);
    if (!acc) profiles.set(key, (acc = { pid, tid, start: NaN, end: NaN, nodes: new Map(), samples: [], deltas: [] }));
    if (name === "Profile") acc.tid = tid;
    const startTime = num(data.startTime, NaN);
    if (!Number.isNaN(startTime)) acc.start = startTime;
    // A whole profile in one event (CpuProfile), or chunks of one.
    const cp = obj(data.cpuProfile) ?? (name === "CpuProfile" ? data : null);
    if (cp) {
      cpuNodes(arr(cp.nodes), acc.nodes);
      for (const s of arr(cp.samples)) acc.samples.push(num(s, -1));
      if (Number.isNaN(acc.start) && cp.startTime !== undefined) acc.start = num(cp.startTime, NaN);
      if (cp.endTime !== undefined) acc.end = num(cp.endTime, NaN);
    }
    for (const d of arr(data.timeDeltas ?? cp?.timeDeltas)) acc.deltas.push(num(d, 0));
  }
  for (const acc of profiles.values()) {
    if (!acc.samples.length && ![...acc.nodes.values()].some((n) => n.hitCount)) continue;
    const thread = b.thread(`${acc.pid}:${acc.tid}:${b.threads.length}`, {
      name: names.get(`${acc.pid}:${acc.tid}`) || `${acc.tid}`,
      tid: acc.tid,
      pid: acc.pid,
      ...(procs.get(acc.pid) ? { process: procs.get(acc.pid)! } : {}),
    });
    const start = Number.isNaN(acc.start) ? 0 : acc.start;
    let end = acc.end;
    if (Number.isNaN(end)) end = start + acc.deltas.reduce((a, d) => a + d, 0);
    addCpuProfile(b, [...acc.nodes.values()], acc.samples, acc.deltas, start, end, thread);
  }
  return b.finish();
}

// --- speedscope ---------------------------------------------------------------------------------

const SPEEDSCOPE_UNITS: Record<string, [string, number]> = {
  nanoseconds: ["nanoseconds", 1],
  microseconds: ["nanoseconds", 1e3],
  milliseconds: ["nanoseconds", 1e6],
  seconds: ["nanoseconds", 1e9],
  bytes: ["bytes", 1],
  none: ["count", 1],
};

export function readSpeedscope(text: string): Profile {
  const root = obj(JSON.parse(text));
  if (!root) throw new Error("not a profile");
  const frames = arr(obj(root.shared)?.frames);
  const profiles = arr(root.profiles).map(obj).filter((p): p is Json => !!p);
  // One value type per unit, so profiles of different units are not added together.
  const units = [...new Set(profiles.map((p) => (SPEEDSCOPE_UNITS[str(p.unit)] ?? SPEEDSCOPE_UNITS.none!)[0]))];
  if (!units.length) units.push("count");
  const b = new ProfileBuilder(units.map((u) => { const label = u === "nanoseconds" ? "time" : u === "bytes" ? "bytes" : "weight"; return { type: label, unit: u, label }; }));
  const frameIds = new Map<number, number>();
  const frameId = (i: number): number => {
    let id = frameIds.get(i);
    if (id === undefined) {
      const f = obj(frames[i]) ?? {};
      const file = str(f.file);
      const name = str(f.name) || `frame ${i}`;
      id = b.frame(name, file ? baseName(file) : "", guessCategory(name, file), file || undefined, num(f.line, 0) || undefined);
      frameIds.set(i, id);
    }
    return id;
  };
  const vals = new Float64Array(units.length);
  profiles.forEach((p, pi) => {
    const [unit, scale] = SPEEDSCOPE_UNITS[str(p.unit)] ?? SPEEDSCOPE_UNITS.none!;
    const vi = units.indexOf(unit);
    const timed = unit === "nanoseconds";
    const thread = b.thread(String(pi), { name: str(p.name) || `#${pi + 1}` });
    const start = num(p.startValue, 0);
    const add = (stack: number, w: number, at: number) => {
      vals.fill(0);
      vals[vi] = w * scale;
      b.sample(stack, thread, vals, timed ? (at - start) * scale : undefined);
    };
    if (p.type === "sampled") {
      const weights = arr(p.weights);
      let at = start;
      arr(p.samples).forEach((s, i) => {
        const w = num(weights[i], 1);
        add(b.stackOf(arr(s).map((f) => frameId(num(f, 0)))), w, at);
        at += w;
      });
      return;
    }
    // Evented: the open stack holds the time between one event and the next.
    const open: number[] = [];
    let stack = -1;
    let last = start;
    for (const raw of arr(p.events)) {
      const e = obj(raw);
      if (!e) continue;
      const at = num(e.at, last);
      if (at > last && stack >= 0) add(stack, at - last, last);
      last = Math.max(last, at);
      const f = frameId(num(e.frame, 0));
      if (e.type === "O") {
        open.push(f);
        stack = b.stack(stack, f);
      } else if (e.type === "C") {
        const k = open.lastIndexOf(f);
        if (k < 0) continue;
        open.length = k;
        stack = b.stackOf(open);
      }
    }
    const end = num(p.endValue, last);
    if (end > last && stack >= 0) add(stack, end - last, last);
  });
  return b.finish();
}
