import { gunzipSync } from "fflate";
import { ProfileBuilder, baseName, guessCategory, type Profile, type ValueType } from "./profile-model";

// Protobuf profiles: pprof (Go, and every tool that writes its Profile message, usually
// gzipped) and Android simpleperf's report-sample --protobuf output.

/** A minimal protobuf reader over one message. */
class Pb {
  pos: number;
  constructor(
    readonly b: Uint8Array,
    start = 0,
    readonly end = b.length,
  ) {
    this.pos = start;
  }
  more(): boolean {
    return this.pos < this.end;
  }
  varint(): number {
    let v = 0;
    let mul = 1;
    const b = this.b;
    const start = this.pos;
    for (let i = 0; i < 8; i++) {
      if (this.pos >= this.end) throw new Error("truncated varint");
      const c = b[this.pos++]!;
      v += (c & 0x7f) * mul;
      if (c < 0x80) return v;
      mul *= 128;
    }
    // Past 56 bits: exact, as a signed 64-bit value (negative numbers take ten bytes).
    let big = 0n;
    this.pos = start;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Error("truncated varint");
      const c = b[this.pos++]!;
      big |= BigInt(c & 0x7f) << BigInt(7 * i);
      if (c < 0x80) return Number(BigInt.asIntN(64, big));
    }
    throw new Error("bad varint");
  }
  tag(): [number, number] {
    const t = this.varint();
    return [Math.floor(t / 8), t % 8];
  }
  /** A length-delimited field's bounds; the reader moves past it. */
  sub(): [number, number] {
    const n = this.varint();
    const start = this.pos;
    if (start + n > this.end) throw new Error("truncated field");
    this.pos += n;
    return [start, start + n];
  }
  skip(wt: number): void {
    if (wt === 0) this.varint();
    else if (wt === 1) this.pos += 8;
    else if (wt === 5) this.pos += 4;
    else if (wt === 2) this.sub();
    else throw new Error(`wire type ${wt}`);
  }
  /** A repeated varint field, packed or not. */
  varints(wt: number, into: number[]): void {
    if (wt === 0) {
      into.push(this.varint());
      return;
    }
    const [s, e] = this.sub();
    const r = new Pb(this.b, s, e);
    while (r.more()) into.push(r.varint());
  }
}

const utf8 = new TextDecoder();
const text = (b: Uint8Array, [s, e]: [number, number]): string => utf8.decode(b.subarray(s, e));
/** An address in hex; the reader returns the high half of the 64-bit space as negative numbers. */
const hex = (v: number): string => (v < 0 ? BigInt.asUintN(64, BigInt(v)).toString(16) : v.toString(16));

/** The raw bytes of a profile, gunzipped when they are gzip. */
export function ungzip(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}

// --- pprof --------------------------------------------------------------------------------------

/** Label keys that name a thread, best first: samples split into threads by them. */
const THREAD_LABELS = ["thread_name", "thread", "threadname", "thread_id", "tid", "goroutine"];

export function readPprof(input: Uint8Array): Profile {
  const b = ungzip(input);
  const strings: string[] = [];
  const sampleTypes: [number, number][] = [];
  const samples: { locs: number[]; vals: number[]; labels: [number, number, number][] }[] = [];
  const mappings = new Map<number, number>();
  const locations = new Map<number, { mapping: number; address: number; lines: number[] }>();
  const functions = new Map<number, { name: number; system: number; file: number }>();
  let defaultType = 0;
  let timeNanos = 0;
  let durationNanos = 0;
  let periodType: [number, number] | null = null;
  let period = 0;
  const comments: number[] = [];
  const r = new Pb(b);
  const valueType = (s: number, e: number): [number, number] => {
    const m = new Pb(b, s, e);
    let type = 0;
    let unit = 0;
    while (m.more()) {
      const [f, wt] = m.tag();
      if (f === 1 && wt === 0) type = m.varint();
      else if (f === 2 && wt === 0) unit = m.varint();
      else m.skip(wt);
    }
    return [type, unit];
  };
  while (r.more()) {
    const [f, wt] = r.tag();
    if (wt !== 2 || ![1, 2, 3, 4, 5, 6, 11].includes(f)) {
      if (f === 9 && wt === 0) timeNanos = r.varint();
      else if (f === 10 && wt === 0) durationNanos = r.varint();
      else if (f === 12 && wt === 0) period = r.varint();
      else if (f === 13) r.varints(wt, comments);
      else if (f === 14 && wt === 0) defaultType = r.varint();
      else r.skip(wt);
      continue;
    }
    const [s, e] = r.sub();
    const m = new Pb(b, s, e);
    if (f === 1) sampleTypes.push(valueType(s, e));
    else if (f === 11) periodType = valueType(s, e);
    else if (f === 6) strings.push(text(b, [s, e]));
    else if (f === 2) {
      const smp = { locs: [] as number[], vals: [] as number[], labels: [] as [number, number, number][] };
      while (m.more()) {
        const [g, w] = m.tag();
        if (g === 1) m.varints(w, smp.locs);
        else if (g === 2) m.varints(w, smp.vals);
        else if (g === 3 && w === 2) {
          const [ls, le] = m.sub();
          const l = new Pb(b, ls, le);
          let key = 0;
          let str = 0;
          let n = 0;
          while (l.more()) {
            const [h, x] = l.tag();
            if (h === 1 && x === 0) key = l.varint();
            else if (h === 2 && x === 0) str = l.varint();
            else if (h === 3 && x === 0) n = l.varint();
            else l.skip(x);
          }
          smp.labels.push([key, str, n]);
        } else m.skip(w);
      }
      samples.push(smp);
    } else if (f === 3) {
      let id = 0;
      let file = 0;
      while (m.more()) {
        const [g, w] = m.tag();
        if (g === 1 && w === 0) id = m.varint();
        else if (g === 5 && w === 0) file = m.varint();
        else m.skip(w);
      }
      mappings.set(id, file);
    } else if (f === 4) {
      const loc = { mapping: 0, address: 0, lines: [] as number[] };
      let id = 0;
      while (m.more()) {
        const [g, w] = m.tag();
        if (g === 1 && w === 0) id = m.varint();
        else if (g === 2 && w === 0) loc.mapping = m.varint();
        else if (g === 3 && w === 0) loc.address = m.varint();
        else if (g === 4 && w === 2) {
          const [ls, le] = m.sub();
          const l = new Pb(b, ls, le);
          let fn = 0;
          let line = 0;
          while (l.more()) {
            const [h, x] = l.tag();
            if (h === 1 && x === 0) fn = l.varint();
            else if (h === 2 && x === 0) line = l.varint();
            else l.skip(x);
          }
          loc.lines.push(fn, line);
        } else m.skip(w);
      }
      locations.set(id, loc);
    } else if (f === 5) {
      const fn = { name: 0, system: 0, file: 0 };
      let id = 0;
      while (m.more()) {
        const [g, w] = m.tag();
        if (g === 1 && w === 0) id = m.varint();
        else if (g === 2 && w === 0) fn.name = m.varint();
        else if (g === 3 && w === 0) fn.system = m.varint();
        else if (g === 4 && w === 0) fn.file = m.varint();
        else m.skip(w);
      }
      functions.set(id, fn);
    }
  }
  const s = (i: number): string => strings[i] ?? "";
  const types: ValueType[] = sampleTypes.map(([t, u]) => ({ type: s(t) || "value", unit: s(u) || "count" }));
  if (!types.length) types.push({ type: "samples", unit: "count", label: "samples" });
  const pb = new ProfileBuilder(types);
  // Location id to its frames, leaf first: a location's lines run from inlined callee to caller.
  const locFrames = new Map<number, number[]>();
  const framesOf = (id: number): number[] => {
    let out = locFrames.get(id);
    if (out) return out;
    out = [];
    const loc = locations.get(id);
    const mapFile = loc ? s(mappings.get(loc.mapping) ?? 0) : "";
    const module = mapFile ? baseName(mapFile) : "";
    if (loc && loc.lines.length) {
      for (let k = 0; k < loc.lines.length; k += 2) {
        const fn = functions.get(loc.lines[k]!);
        const name = fn ? s(fn.name) || s(fn.system) : "";
        const file = fn ? s(fn.file) : "";
        const line = loc.lines[k + 1]!;
        out.push(pb.frame(name || `0x${hex(loc.address)}`, module || (file ? baseName(file) : ""), guessCategory(name, file || mapFile), file || undefined, line || undefined));
      }
    } else out.push(pb.frame(loc ? `0x${hex(loc.address)}` : `#${id}`, module, guessCategory("", mapFile)));
    locFrames.set(id, out);
    return out;
  };
  // Samples split into threads by a thread label, when they carry one.
  const keyIds = new Map<string, number>();
  strings.forEach((v, i) => keyIds.has(v) || keyIds.set(v, i));
  const present = new Set<number>();
  for (const smp of samples) for (const [k] of smp.labels) present.add(k);
  const threadKey = THREAD_LABELS.map((k) => keyIds.get(k)).find((k) => k !== undefined && present.has(k)) ?? -1;
  const noThread = pb.thread("", { name: "" });
  // Every label key gets a column of values, to group the samples by any of them.
  const keyCols = new Map<number, number[]>();
  const labelStrings: string[] = [];
  const labelIds = new Map<string, number>();
  const labelId = (v: string): number => {
    let id = labelIds.get(v);
    if (id === undefined) {
      id = labelStrings.length;
      labelStrings.push(v);
      labelIds.set(v, id);
    }
    return id;
  };
  for (const k of present) keyCols.set(k, []);
  const frames: number[] = [];
  for (const smp of samples) {
    frames.length = 0;
    for (let k = smp.locs.length - 1; k >= 0; k--) {
      const fs = framesOf(smp.locs[k]!);
      for (let j = fs.length - 1; j >= 0; j--) frames.push(fs[j]!);
    }
    const stack = pb.stackOf(frames);
    if (stack < 0) continue;
    let thread = noThread;
    for (const col of keyCols.values()) col.push(-1);
    for (const [k, v, n] of smp.labels) {
      const name = v ? s(v) : String(n);
      const col = keyCols.get(k)!;
      col[col.length - 1] = labelId(name);
      if (k === threadKey) thread = pb.thread(`t:${name}`, { name });
    }
    pb.sample(stack, thread, smp.vals);
  }
  const keys = [...keyCols.keys()].filter((k) => s(k));
  for (const c of comments) if (s(c)) pb.notes.push(`comment:${s(c)}`);
  if (periodType && period) pb.notes.push(`period:${period} ${s(periodType[1])}`);
  let def = 0;
  if (defaultType) def = Math.max(0, types.findIndex((t) => t.type === s(defaultType)));
  // Without a default, pprof shows the last sample type (cpu after samples, inuse after alloc).
  else if (types.length > 1) def = types.length - 1;
  return pb.finish({
    defaultValue: def,
    ...(keys.length ? { labels: { keys: keys.map(s), values: keys.map((k) => Int32Array.from(keyCols.get(k)!)), strings: labelStrings } } : {}),
    ...(timeNanos ? { startedAt: timeNanos / 1e6 } : {}),
    ...(durationNanos ? { duration: durationNanos } : {}),
  });
}

// --- simpleperf ---------------------------------------------------------------------------------

const EXECUTION_TYPES = ["", "Java", "Java", "Java"];

export function readSimpleperf(input: Uint8Array): Profile {
  const b = ungzip(input);
  if (utf8.decode(b.subarray(0, 10)) !== "SIMPLEPERF") throw new Error("not a simpleperf profile");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  interface Smp {
    time: number;
    tid: number;
    count: number;
    event: number;
    chain: number[];
  }
  const samples: Smp[] = [];
  const files = new Map<number, { path: string; symbols: string[] }>();
  const threads = new Map<number, { pid: number; name: string }>();
  let eventTypes: string[] = [];
  let lost = 0;
  let app = "";
  let pos = 12;
  while (pos + 4 <= b.length) {
    const size = view.getUint32(pos, true);
    pos += 4;
    if (size === 0 || pos + size > b.length) break;
    const r = new Pb(b, pos, pos + size);
    pos += size;
    while (r.more()) {
      const [f, wt] = r.tag();
      if (wt !== 2) {
        r.skip(wt);
        continue;
      }
      const [s, e] = r.sub();
      const m = new Pb(b, s, e);
      if (f === 1) {
        const smp: Smp = { time: 0, tid: 0, count: 1, event: 0, chain: [] };
        while (m.more()) {
          const [g, w] = m.tag();
          if (g === 1 && w === 0) smp.time = m.varint();
          else if (g === 2 && w === 0) smp.tid = m.varint();
          else if (g === 4 && w === 0) smp.count = m.varint();
          else if (g === 5 && w === 0) smp.event = m.varint();
          else if (g === 3 && w === 2) {
            const [cs, ce] = m.sub();
            const c = new Pb(b, cs, ce);
            let vaddr = 0;
            let file = 0;
            let sym = -1;
            let exec = 0;
            while (c.more()) {
              const [h, x] = c.tag();
              if (h === 1 && x === 0) vaddr = c.varint();
              else if (h === 2 && x === 0) file = c.varint();
              else if (h === 3 && x === 0) sym = c.varint() | 0;
              else if (h === 4 && x === 0) exec = c.varint();
              else c.skip(x);
            }
            smp.chain.push(file, sym, vaddr, exec);
          } else m.skip(w);
        }
        samples.push(smp);
      } else if (f === 2) {
        let sampleCount = 0;
        let lostCount = 0;
        while (m.more()) {
          const [g, w] = m.tag();
          if (g === 1 && w === 0) sampleCount = m.varint();
          else if (g === 2 && w === 0) lostCount = m.varint();
          else m.skip(w);
        }
        lost += lostCount;
        void sampleCount;
      } else if (f === 3) {
        const file = { path: "", symbols: [] as string[] };
        let id = 0;
        while (m.more()) {
          const [g, w] = m.tag();
          if (g === 1 && w === 0) id = m.varint();
          else if (g === 2 && w === 2) file.path = text(b, m.sub());
          else if (g === 3 && w === 2) file.symbols.push(text(b, m.sub()));
          else m.skip(w);
        }
        files.set(id, file);
      } else if (f === 4) {
        let tid = 0;
        let pid = 0;
        let name = "";
        while (m.more()) {
          const [g, w] = m.tag();
          if (g === 1 && w === 0) tid = m.varint();
          else if (g === 2 && w === 0) pid = m.varint();
          else if (g === 3 && w === 2) name = text(b, m.sub());
          else m.skip(w);
        }
        threads.set(tid, { pid, name });
      } else if (f === 5) {
        const types: string[] = [];
        while (m.more()) {
          const [g, w] = m.tag();
          if (g === 1 && w === 2) types.push(text(b, m.sub()));
          else if (g === 2 && w === 2) app = text(b, m.sub());
          else m.skip(w);
        }
        if (types.length) eventTypes = types;
      }
    }
  }
  const nEvents = Math.max(1, eventTypes.length, ...samples.map((x) => x.event + 1));
  const names = Array.from({ length: nEvents }, (_, i) => eventTypes[i] ?? `event ${i}`);
  // Each event: its sample count, then its event count (ns for clock events).
  const types = [
    ...names.map((n) => ({ type: n, unit: "count" })),
    ...names.map((n) => ({ type: n, unit: /clock/.test(n) ? "nanoseconds" : "events", label: "events" as const })),
  ];
  const pb = new ProfileBuilder(types);
  const frameIds = new Map<string, number>();
  const frame = (file: number, sym: number, vaddr: number, exec: number): number => {
    const known = files.get(file);
    // Unsymbolized addresses merge per file: one frame for all of an unknown library or the kernel.
    const key = sym >= 0 && known?.symbols[sym] !== undefined ? `${file}:${sym}` : known?.path ? `${file}:?` : `@${hex(vaddr)}`;
    let id = frameIds.get(key);
    if (id !== undefined) return id;
    const path = known?.path ?? "";
    const name = (sym >= 0 ? known?.symbols[sym] : undefined) ?? (path ? baseName(path) : `0x${hex(vaddr)}`);
    const cat = EXECUTION_TYPES[exec] || guessCategory(name, path);
    id = pb.frame(name, path ? baseName(path) : "", cat, path || undefined);
    frameIds.set(key, id);
    return id;
  };
  const vals = new Float64Array(types.length);
  const frames: number[] = [];
  for (const smp of samples) {
    frames.length = 0;
    // The callchain runs from the sampled instruction out to the thread's entry.
    for (let k = smp.chain.length - 4; k >= 0; k -= 4) frames.push(frame(smp.chain[k]!, smp.chain[k + 1]!, smp.chain[k + 2]!, smp.chain[k + 3]!));
    const th = threads.get(smp.tid);
    const pid = th?.pid ?? smp.tid;
    const proc = threads.get(pid)?.name ?? "";
    const thread = pb.thread(String(smp.tid), { name: th?.name ?? "", tid: smp.tid, pid, ...(proc ? { process: proc } : {}) });
    vals.fill(0);
    vals[smp.event] = 1;
    vals[nEvents + smp.event] = smp.count;
    pb.sample(pb.stackOf(frames), thread, vals, smp.time);
  }
  if (lost) pb.notes.push(`lost:${lost}`);
  if (app) pb.notes.push(`app:${app}`);
  return pb.finish();
}
