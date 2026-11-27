import { LOG_CAP, type TraceSummary } from "./perfetto-parse";
import { ThreadState, type ModelBuilder } from "./trace-model";
import { tally, type TraceStats } from "./trace-stats";

// Fuchsia trace format (FXT): 64-bit words, each record starting with a header word (type in
// bits 0-3, size in words in bits 4-15). Strings and threads are interned per provider and
// referenced by index, or written inline. Spec: fuchsia.dev/fuchsia-src/reference/tracing/trace-format

const TWO32 = 4294967296;

/** Bits [from, to] of the 64-bit word lo + hi * 2^32 (at most 32 of them). */
function bits(lo: number, hi: number, from: number, to: number): number {
  const width = to - from + 1;
  const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
  let v: number;
  if (to < 32) v = lo >>> from;
  else if (from >= 32) v = hi >>> (from - 32);
  else v = (lo >>> from) | (hi << (32 - from));
  return (v & mask) >>> 0;
}

interface Provider {
  name: string;
  tps: number;
  strings: Map<number, string>;
  threads: Map<number, [number, number]>;
}

interface Arg {
  name: string;
  value: number | string | boolean | null;
  type: number;
}

const FX_STATE: Record<number, number> = { 0: ThreadState.Runnable, 1: ThreadState.Runnable, 2: ThreadState.Stopped, 3: ThreadState.Sleeping, 4: ThreadState.Dead, 5: ThreadState.Dead };
const IDLE_WEIGHT = -2147483648;
const EVENT_KINDS = ["instant", "counter", "begin", "end", "complete", "async begin", "async instant", "async end", "flow begin", "flow step", "flow end"];

export function readFuchsiaInto(b: ModelBuilder, bytes: Uint8Array, s: TraceSummary): TraceStats {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const providers = new Map<number, Provider>();
  const provider = (id: number, name = ""): Provider => {
    let p = providers.get(id);
    if (!p) providers.set(id, (p = { name, tps: 1e9, strings: new Map(), threads: new Map() }));
    return p;
  };
  let cur = provider(0);
  // Koids are 64-bit; ones too big for a 32-bit id get small numbers of their own.
  const ids = new Map<number, number>();
  let nextId = 1 << 30;
  const id = (koid: number): number => {
    if (koid < 0x7fffffff) return koid;
    let v = ids.get(koid);
    if (v === undefined) ids.set(koid, (v = nextId++));
    return v;
  };
  const cats = new Map<string, [number, number]>();
  const kinds = new Map<string, [number, number]>();
  let records = 0;
  let bad = 0;
  let pos = 0;
  let end = 0;
  const lo32 = (at: number) => dv.getUint32(at, true);
  const hi32 = (at: number) => dv.getUint32(at + 4, true);
  const u64 = (at: number) => lo32(at) + hi32(at) * TWO32;
  const i64 = (at: number) => lo32(at) + (hi32(at) | 0) * TWO32;
  const word = (): number => {
    if (pos + 8 > end) throw new RangeError("record");
    const v = u64(pos);
    pos += 8;
    return v;
  };
  const inline = (len: number): string => {
    if (pos + len > end) throw new RangeError("string");
    let n = len;
    while (n > 0 && bytes[pos + n - 1] === 0) n--;
    const str = dec.decode(bytes.subarray(pos, pos + n));
    pos += (len + 7) & ~7;
    return str;
  };
  const str = (ref: number): string => (ref & 0x8000 ? inline(ref & 0x7fff) : ref ? (cur.strings.get(ref) ?? "") : "");
  const thread = (ref: number): [number, number] => {
    if (ref) return cur.threads.get(ref) ?? [0, 0];
    const pid = word();
    return [pid, word()];
  };
  const ts = (ticks: number): number => (cur.tps === 1e9 ? ticks : (ticks / cur.tps) * 1e9);
  const args = (n: number): Arg[] => {
    const out: Arg[] = [];
    for (let i = 0; i < n; i++) {
      const base = pos;
      const lo = lo32(pos);
      const hi = hi32(pos);
      pos += 8;
      const type = lo & 15;
      const size = bits(lo, hi, 4, 15);
      const name = str(bits(lo, hi, 16, 31));
      let value: Arg["value"] = null;
      if (type === 1) value = hi | 0;
      else if (type === 2) value = hi >>> 0;
      else if (type === 3) value = i64(pos);
      else if (type === 4 || type === 7 || type === 8) value = u64(pos);
      else if (type === 5) value = dv.getFloat64(pos, true);
      else if (type === 6) value = str(bits(lo, hi, 32, 47));
      else if (type === 9) value = (hi & 1) === 1;
      out.push({ name, value, type });
      pos = base + Math.max(1, size) * 8;
    }
    return out;
  };
  const argText = (cat: string, list: Arg[]): string =>
    [cat ? `category: ${cat}` : "", ...list.map((a) => `${a.name}: ${a.type === 7 ? `0x${(a.value as number).toString(16)}` : String(a.value)}`)].filter(Boolean).join("\n");

  while (pos + 8 <= bytes.length) {
    const start = pos;
    const lo = lo32(pos);
    const hi = hi32(pos);
    const type = lo & 15;
    const size = type === 15 ? bits(lo, hi, 4, 35) : bits(lo, hi, 4, 15);
    if (!size) break;
    end = Math.min(bytes.length, start + size * 8);
    pos = start + 8;
    records++;
    try {
      switch (type) {
        case 0: {
          const mt = bits(lo, hi, 16, 19);
          if (mt === 1) cur = provider(bits(lo, hi, 20, 51), inline(bits(lo, hi, 52, 59)));
          else if (mt === 2) cur = provider(bits(lo, hi, 20, 51));
          break;
        }
        case 1:
          cur.tps = word() || 1e9;
          break;
        case 2: {
          const index = bits(lo, hi, 16, 30);
          if (index) cur.strings.set(index, inline(bits(lo, hi, 32, 46)));
          break;
        }
        case 3: {
          const index = bits(lo, hi, 16, 23);
          if (index) cur.threads.set(index, [word(), word()]);
          break;
        }
        case 4:
          event(lo, hi);
          break;
        case 7: {
          const objType = bits(lo, hi, 16, 23);
          const koid = word();
          const name = str(bits(lo, hi, 24, 39));
          if (objType === 1) b.process(id(koid), name);
          else if (objType === 2) {
            const pid = args(bits(lo, hi, 40, 43)).find((a) => a.name === "process")?.value;
            b.thread(id(koid), typeof pid === "number" ? id(pid) : undefined, name);
          }
          break;
        }
        case 8:
          sched(lo, hi);
          break;
        case 9: {
          const len = bits(lo, hi, 16, 30);
          const t = ts(word());
          const [pid, tid] = thread(bits(lo, hi, 32, 39));
          const msg = inline(len);
          s.logTotal++;
          if (s.logs.length < LOG_CAP) s.logs.push({ ts: t, pid: id(pid), tid: id(tid), prio: 4, tag: "", msg });
          b.thread(id(tid), id(pid));
          b.slice(`t:${id(tid)}`, t, 0, b.name("log"), b.arg(msg));
          break;
        }
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      bad++;
    }
    pos = start + size * 8;
  }

  function event(lo: number, hi: number): void {
    const kind = bits(lo, hi, 16, 19);
    const t = ts(word());
    const [pidK, tidK] = thread(bits(lo, hi, 24, 31));
    const cat = str(bits(lo, hi, 32, 47));
    const name = str(bits(lo, hi, 48, 63));
    const list = args(bits(lo, hi, 20, 23));
    const pid = id(pidK);
    const tid = id(tidK);
    b.thread(tid, pid);
    const track = `t:${tid}`;
    const k = kinds.get(EVENT_KINDS[kind] ?? String(kind)) ?? [0, 0];
    k[0]++;
    kinds.set(EVENT_KINDS[kind] ?? String(kind), k);
    if (cat) {
      const c = cats.get(cat) ?? [0, 0];
      c[0]++;
      cats.set(cat, c);
    }
    const arg = () => (cat || list.length ? b.arg(argText(cat, list)) : -1);
    switch (kind) {
      case 0:
        b.slice(track, t, 0, b.name(name), arg());
        break;
      case 1: {
        const counter = word();
        for (const a of list) {
          if (typeof a.value !== "number") continue;
          const label = `${name}:${a.name}:${counter}`;
          b.counter(`fc:${pid}:${label}`, t, a.value, { label, pid });
        }
        break;
      }
      case 2:
        b.begin(track, track, t, b.name(name), arg());
        break;
      case 3:
        b.end(track, t);
        break;
      case 4:
        b.slice(track, t, Math.max(0, ts(word()) - t), b.name(name), arg());
        break;
      case 5:
      case 6:
      case 7: {
        const corr = word();
        const at = `fa:${pid}:${name}`;
        b.describe(at, { label: name, pid });
        if (kind === 5) b.begin(`${at}:${corr}`, at, t, b.name(name), arg());
        else if (kind === 6) b.slice(at, t, 0, b.name(name), arg());
        else b.end(`${at}:${corr}`, t);
        break;
      }
      case 8:
      case 9:
      case 10:
        b.flowPoint(`ff:${word()}`, track, t, kind - 8);
        break;
    }
  }

  function sched(lo: number, hi: number): void {
    const kind = bits(lo, hi, 60, 63);
    if (kind === 0) {
      const cpu = bits(lo, hi, 16, 23);
      const state = bits(lo, hi, 24, 27);
      const outRef = bits(lo, hi, 28, 35);
      const inRef = bits(lo, hi, 36, 43);
      const inPrio = bits(lo, hi, 52, 59);
      const t = ts(word());
      thread(outRef);
      const [inPid, inTid] = thread(inRef);
      const idle = inPid === 0 && inPrio === 0;
      if (!idle) b.thread(id(inTid), inPid ? id(inPid) : undefined);
      b.switchTo(cpu, t, idle ? 0 : id(inTid), FX_STATE[state] ?? -1);
    } else if (kind === 1) {
      const cpu = bits(lo, hi, 20, 35);
      const state = bits(lo, hi, 36, 39);
      const t = ts(word());
      word();
      const inTid = word();
      const list = args(bits(lo, hi, 16, 19));
      const idle = list.find((a) => a.name === "incoming_weight")?.value === IDLE_WEIGHT;
      if (!idle) b.thread(id(inTid));
      b.switchTo(cpu, t, idle ? 0 : id(inTid), FX_STATE[state] ?? -1);
    } else if (kind === 2) {
      const t = ts(word());
      const tid = word();
      const list = args(bits(lo, hi, 16, 19));
      if (list.find((a) => a.name === "weight")?.value !== IDLE_WEIGHT) b.waking(t, id(tid));
    }
  }

  const stats: TraceStats = {
    facts: [
      { key: "fxtRecords", value: records, kind: "count" },
      { key: "fxtProviders", value: providers.size, kind: "count" },
    ],
    tables: [
      { title: "fxtEvents", cols: [{ key: "event", kind: "text" }, { key: "count", kind: "count" }], rows: tally(kinds, 1).map((r) => [r[0]!, r[1]!]), bar: 1 },
      { title: "fxtCategories", cols: [{ key: "fxtCategory", kind: "text" }, { key: "count", kind: "count" }], rows: tally(cats, 1).map((r) => [r[0]!, r[1]!]), bar: 1 },
    ],
  };
  if (bad) stats.facts.push({ key: "fxtBad", value: bad, kind: "count" });
  return stats;
}
