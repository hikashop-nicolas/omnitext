import { decompressSync } from "fflate";
import { FTRACE_EVENTS, PACKET_FIELDS } from "./perfetto-names";
import { ModelBuilder, kernelState, type TraceModel } from "./trace-model";
import { atraceEvent } from "./trace-atrace";

// Reads a Perfetto trace (a protobuf Trace: repeated TracePacket packet = 1) with a hand-written
// protobuf reader into a summary and the timeline model. Field numbers: perfetto/protos/perfetto/trace.

export interface ProcessInfo {
  pid: number;
  ppid?: number;
  uid?: number;
  name?: string;
  cmdline?: string;
  rssKb?: number;
}

export interface ThreadInfo {
  tid: number;
  pid?: number;
  name?: string;
}

export interface LogEntry {
  ts: number;
  pid: number;
  tid: number;
  prio: number;
  tag: string;
  msg: string;
}

export interface SystemInfo {
  kernel?: string;
  fingerprint?: string;
  manufacturer?: string;
  soc?: string;
  sdk?: number;
  cpus?: number;
  service?: string;
}

export interface TraceSummary {
  bytes: number;
  /** Bytes of the outer stream read so far. */
  read: number;
  packets: number;
  firstTs: number | null;
  lastTs: number | null;
  /** Wall-clock time (ms since epoch) of firstTs, from a clock snapshot. */
  wallStartMs: number | null;
  packetTypes: Map<string, number>;
  ftrace: Map<string, number>;
  ftraceTotal: number;
  cpus: Set<number>;
  lostBundles: number;
  processes: Map<number, ProcessInfo>;
  threads: Map<number, ThreadInfo>;
  logs: LogEntry[];
  logTotal: number;
  system: SystemInfo | null;
  zstdPackets: number;
  badCompressed: number;
  /** Set when the stream stopped being valid protobuf (a cut-off or damaged file). */
  stoppedAt: number | null;
}

export const LOG_CAP = 50_000;
const NAME_CAP = 5000;

class Malformed extends Error {}

class StopAt extends Error {
  constructor(readonly at: number) {
    super("stop");
  }
}

/** A zstd packet came before the decoder was loaded: load it and read again from `at`. */
class NeedZstd extends Error {
  constructor(readonly at: number) {
    super("zstd");
  }
}

export type Inflate = (bytes: Uint8Array) => Uint8Array;

// Minimal protobuf reader. Varints come back as Numbers (exact up to 2^53), `lo` keeps the low 32 bits.
class Reader {
  pos: number;
  lo = 0;
  constructor(readonly buf: Uint8Array, start: number, readonly end: number) {
    this.pos = start;
  }
  varint(): number {
    const buf = this.buf;
    if (this.pos >= this.end) throw new Malformed();
    let b = buf[this.pos++]!;
    if (b < 0x80) {
      this.lo = b;
      return b;
    }
    let lo = b & 0x7f;
    let v = lo;
    let mul = 128;
    let shift = 7;
    do {
      if (this.pos >= this.end) throw new Malformed();
      b = buf[this.pos++]!;
      if (shift < 32) lo |= (b & 0x7f) << shift;
      v += (b & 0x7f) * mul;
      mul *= 128;
      shift += 7;
    } while (b >= 0x80 && shift < 70);
    this.lo = lo;
    return v;
  }
  int32(): number {
    this.varint();
    return this.lo | 0;
  }
  /** int64 as a Number: two's complement negatives come back negative. */
  int64(): number {
    const v = this.varint();
    return v >= 2 ** 63 ? v - 2 ** 64 : v;
  }
  /** A 64-bit id (track uuid) as a string key that keeps all its bits. */
  idKey(): string {
    const v = this.varint();
    return `${Math.floor(v / 2 ** 32)}:${this.lo >>> 0}`;
  }
  double(): number {
    if (this.pos + 8 > this.end) throw new Malformed();
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }
  /** Reads a length prefix and returns the end of the delimited range. */
  len(): number {
    const n = this.varint();
    const e = this.pos + n;
    if (e > this.end) throw new Malformed();
    return e;
  }
  skip(wt: number): void {
    if (wt === 0) this.varint();
    else if (wt === 1) this.pos += 8;
    else if (wt === 2) this.pos = this.len();
    else if (wt === 5) this.pos += 4;
    else throw new Malformed();
    if (this.pos > this.end) throw new Malformed();
  }
}

const utf8 = new TextDecoder("utf-8");
const str = (r: Reader, e: number): string => utf8.decode(r.buf.subarray(r.pos, e));

function bump(m: Map<string, number>, key: string, n = 1): void {
  const v = m.get(key);
  if (v !== undefined) m.set(key, v + n);
  else if (m.size < NAME_CAP) m.set(key, n);
  else m.set("…", (m.get("…") ?? 0) + n);
}

export function emptySummary(bytes: number): TraceSummary {
  return {
    bytes, read: 0, packets: 0, firstTs: null, lastTs: null, wallStartMs: null,
    packetTypes: new Map(), ftrace: new Map(), ftraceTotal: 0, cpus: new Set(), lostBundles: 0,
    processes: new Map(), threads: new Map(),
    logs: [], logTotal: 0, system: null, zstdPackets: 0, badCompressed: 0, stoppedAt: null,
  };
}

/** Packet field names, `field #N` for numbers this build does not know. */
export const packetFieldName = (n: number): string => PACKET_FIELDS[n] ?? `field #${n}`;
export const ftraceEventName = (n: number): string => FTRACE_EVENTS[n] ?? `event #${n}`;

const BOOTTIME = 6;

/** A sequence-scoped clock (id 64 and up) as a ClockSnapshot on that sequence defines it. */
interface SeqClock {
  ref: number;
  /** The snapshot's value of a global clock, and which one: often MONOTONIC, not the trace clock. */
  base: number;
  baseClock: number;
  mult: number;
  incremental: boolean;
  last: number;
}

/** Per writer sequence: interning tables, packet defaults and clocks. */
interface SeqState {
  names: Map<number, string>;
  annNames: Map<number, string>;
  annStrings: Map<number, string>;
  clockId: number;
  track: string | null;
  tid: number | null;
  clocks: Map<number, SeqClock>;
  /** Legacy TrackEvent times (Chrome before 2020): the running timestamp and thread time, in µs. */
  refUs: number | null;
  refTtUs: number | null;
}

interface TrackDesc {
  name?: string;
  pid?: number;
  tid?: number;
  parent?: string;
  counter: boolean;
  incremental: boolean;
}

class TraceParser {
  private wall: { realtime: number; primary: number } | null = null;
  /** Offset to the trace clock for global clocks (MONOTONIC, REALTIME...), from the first snapshot. */
  private offsets = new Map<number, number>();
  private primary = BOOTTIME;
  private seqs = new Map<number, SeqState>();
  private tracks = new Map<string, TrackDesc>();
  private incCounters = new Map<string, number>();
  private described = new Set<string>();
  /** Boot time minus ftrace time, from the last bundle on the global or local clock that said. */
  private ftraceShift: number | null = null;
  /** Decoder for zstd_compressed_packets, loaded on the first one. */
  zstd: Inflate | null = null;
  /** Whether a zstd packet without a decoder stops the read to load one (else it is skipped). */
  askZstd = true;
  private nested = 0;
  constructor(readonly s: TraceSummary, readonly b: ModelBuilder) {}

  private ts(t: number): void {
    if (!(t > 0)) return;
    const s = this.s;
    if (s.firstTs === null || t < s.firstTs) s.firstTs = t;
    if (s.lastTs === null || t > s.lastTs) s.lastTs = t;
  }

  private seq(id: number): SeqState {
    let st = this.seqs.get(id);
    if (!st) {
      st = { names: new Map(), annNames: new Map(), annStrings: new Map(), clockId: 0, track: null, tid: null, clocks: new Map(), refUs: null, refTtUs: null };
      this.seqs.set(id, st);
    }
    return st;
  }

  /** Parses one Trace byte range packet by packet; returns where it stopped. */
  packets(buf: Uint8Array, start: number, end: number, budget: () => boolean): number {
    const r = new Reader(buf, start, end);
    while (r.pos < end) {
      const at = r.pos;
      try {
        const tag = r.varint();
        if (tag !== 0x0a) throw new StopAt(at);
        const e = r.len();
        this.packet(buf, r.pos, e);
        r.pos = e;
      } catch (e) {
        if (e instanceof Malformed) throw new StopAt(at);
        if (e instanceof NeedZstd) throw new NeedZstd(at);
        throw e;
      }
      if (budget()) return r.pos;
    }
    return r.pos;
  }

  private packet(buf: Uint8Array, start: number, end: number): void {
    const s = this.s;
    const r = new Reader(buf, start, end);
    let data = 0;
    let dStart = 0;
    let dEnd = 0;
    let seqId = 0;
    let flags = 0;
    let iStart = -1;
    let iEnd = -1;
    let defStart = -1;
    let defEnd = -1;
    let raw = -1;
    let clockId = -1;
    let trustedPid = 0;
    try {
      while (r.pos < end) {
        const tag = r.varint();
        const field = tag >>> 3;
        const wt = tag & 7;
        if (field === 8 && wt === 0) raw = r.varint();
        else if (field === 58 && wt === 0) clockId = r.varint();
        else if (field === 79 && wt === 0) trustedPid = r.int32();
        else if (field === 10 && wt === 0) seqId = r.varint();
        else if (field === 13 && wt === 0) flags |= r.varint();
        else if (field === 41 && wt === 0) flags |= r.varint() ? 1 : 0;
        else if (field === 12 && wt === 2) {
          iEnd = r.len();
          iStart = r.pos;
          r.pos = iEnd;
        } else if (field === 59 && wt === 2) {
          defEnd = r.len();
          defStart = r.pos;
          r.pos = defEnd;
        } else if (wt === 2 && !data) {
          // Every data type is a message or bytes; unknown ones still get counted by number.
          dEnd = r.len();
          dStart = r.pos;
          data = field;
          r.pos = dEnd;
        } else r.skip(wt);
      }
    } catch (e) {
      if (!(e instanceof Malformed)) throw e;
    }
    // Nothing is counted yet, so the packet can be read again once the decoder is there.
    if (data === 133 && !this.zstd && this.askZstd && !this.nested) throw new NeedZstd(start);
    s.packets++;
    bump(s.packetTypes, data ? packetFieldName(data) : iStart >= 0 ? "interned_data" : "(empty)");
    const seq = this.seq(seqId);
    if (flags & 1) {
      seq.names.clear();
      seq.annNames.clear();
      seq.annStrings.clear();
    }
    if (defStart >= 0) this.safe(() => this.defaults(new Reader(buf, defStart, defEnd), seq));
    if (iStart >= 0) this.safe(() => this.internedData(new Reader(buf, iStart, iEnd), seq));
    const ts = raw >= 0 ? this.toTrace(raw, clockId >= 0 ? clockId : seq.clockId, seq) : null;
    if (ts !== null) this.ts(ts);
    if (!data) return;
    const d = new Reader(buf, dStart, dEnd);
    this.safe(() => {
      switch (data) {
        case 1: return this.ftraceBundle(d);
        case 2: return this.processTree(d);
        case 6: return this.clockSnapshot(d, seq);
        case 9: return this.processStats(d);
        case 11: return raw < 0 || ts !== null ? this.trackEvent(d, seq, ts, trustedPid) : undefined;
        case 39: return this.androidLog(d);
        case 40: return this.powerRails(d, ts);
        case 43: return this.processDescriptor(d);
        case 44: return this.threadDescriptor(d, seq);
        case 45: return this.systemInfo(d);
        case 50: return this.compressed(buf.subarray(dStart, dEnd), decompressSync);
        case 60: return this.trackDescriptor(d);
        case 133:
          if (this.zstd) return this.compressed(buf.subarray(dStart, dEnd), this.zstd);
          s.zstdPackets++;
          return;
      }
    });
  }

  /** A packet timestamp on the trace clock, or null when its clock is unknown. */
  private toTrace(raw: number, clockId: number, seq: SeqState): number | null {
    if (clockId === 0 || clockId === this.primary) return raw;
    if (clockId >= 64) {
      const c = seq.clocks.get(clockId);
      if (!c) return null;
      const v = c.incremental ? (c.last += raw) : raw;
      const off = c.baseClock === this.primary ? 0 : this.offsets.get(c.baseClock);
      return off === undefined ? null : c.base + off + (v - c.ref) * c.mult;
    }
    const off = this.offsets.get(clockId);
    return off === undefined ? null : raw + off;
  }

  // A damaged sub-message drops what it carried, not the rest of the trace.
  private safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      if (!(e instanceof Malformed)) throw e;
    }
  }

  private each(r: Reader, fn: (field: number, wt: number) => boolean): void {
    while (r.pos < r.end) {
      const tag = r.varint();
      if (!fn(tag >>> 3, tag & 7)) r.skip(tag & 7);
    }
  }

  private sub(r: Reader): Reader {
    const e = r.len();
    const sub = new Reader(r.buf, r.pos, e);
    r.pos = e;
    return sub;
  }

  private text(r: Reader): string {
    const e = r.len();
    const v = str(r, e);
    r.pos = e;
    return v;
  }

  private defaults(r: Reader, seq: SeqState): void {
    this.each(r, (f, wt) => {
      if (f === 58 && wt === 0) seq.clockId = r.varint();
      else if (f === 11 && wt === 2) {
        const d = this.sub(r);
        this.each(d, (df, dwt) => {
          if (df === 11 && dwt === 0) seq.track = d.idKey();
          else return false;
          return true;
        });
      } else return false;
      return true;
    });
  }

  private ftraceBundle(r: Reader): void {
    const s = this.s;
    let clock = 0;
    let ftraceTs = -1;
    let bootTs = -1;
    let cpu = 0;
    const events: Reader[] = [];
    let compact: Reader | null = null;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) {
        cpu = r.varint();
        s.cpus.add(cpu);
      } else if (f === 2 && wt === 2) events.push(this.sub(r));
      else if (f === 3 && wt === 0) s.lostBundles += r.varint() ? 1 : 0;
      else if (f === 4 && wt === 2) compact = this.sub(r);
      else if (f === 5 && wt === 0) clock = r.varint();
      else if (f === 6 && wt === 0) ftraceTs = r.int64();
      else if (f === 7 && wt === 0) bootTs = r.int64();
      else return false;
      return true;
    });
    // Older kernels trace on the global or local clock: the bundle pairs one of its readings
    // with boot time. MONO_RAW goes through the clock snapshots. Other clocks are left out.
    let shift: number | null = null;
    if (clock === 0) shift = 0;
    else if (clock === 2 || clock === 3) {
      if (ftraceTs >= 0 && bootTs >= 0) this.ftraceShift = bootTs - ftraceTs;
      shift = this.ftraceShift;
    } else if (clock === 4) shift = this.primary === 4 ? 0 : (this.offsets.get(4) ?? null);
    for (const e of events) this.safe(() => this.ftraceEvent(e, cpu, shift));
    if (compact) this.safe(() => this.compactSched(compact!, cpu, shift));
  }

  /** One ftrace event; `shift` takes its time to the trace clock, null when it cannot. */
  private ftraceEvent(r: Reader, cpu: number, shift: number | null): void {
    let kind = 0;
    let ts = 0;
    let pid = 0;
    let body: Reader | null = null;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) ts = r.varint();
      else if (f === 2 && wt === 0) pid = r.varint();
      else if (f === 5) return false;
      else if (!kind) {
        kind = f;
        if (wt === 2 && (f === 3 || f === 4 || f === 11 || f === 17 || f === 20 || f === 114)) body = this.sub(r);
        else return false;
      } else return false;
      return true;
    });
    if (!kind) return;
    this.s.ftraceTotal++;
    bump(this.s.ftrace, ftraceEventName(kind));
    if (shift === null) return;
    ts += shift;
    this.ts(ts);
    const b = body as Reader | null;
    if (!b) return;
    if (kind === 3) {
      let buf = "";
      this.each(b, (f, wt) => {
        if (f === 2 && wt === 2) buf = this.text(b);
        else return false;
        return true;
      });
      atraceEvent(this.b, ts, pid, buf);
    } else if (kind === 4) {
      let nextPid = -1;
      let nextComm = "";
      let prevPid = -1;
      let prevComm = "";
      let prevState = -1;
      this.each(b, (f, wt) => {
        if (f === 6 && wt === 0) nextPid = b.int32();
        else if (f === 5 && wt === 2) nextComm = this.text(b);
        else if (f === 2 && wt === 0) prevPid = b.int32();
        else if (f === 1 && wt === 2) prevComm = this.text(b);
        else if (f === 4 && wt === 0) prevState = kernelState(b.int64());
        else return false;
        return true;
      });
      if (prevPid > 0 && prevComm) this.b.thread(prevPid, undefined, this.b.threads.get(prevPid)?.name ?? prevComm);
      if (nextPid >= 0) {
        if (nextPid > 0 && nextComm && !this.b.threads.get(nextPid)?.name) this.b.thread(nextPid, undefined, nextComm);
        this.b.switchTo(cpu, ts, nextPid, prevState);
      }
    } else if (kind === 17 || kind === 20 || kind === 114) {
      let pid = -1;
      this.each(b, (f, wt) => {
        if (f === 2 && wt === 0) pid = b.int32();
        else return false;
        return true;
      });
      this.b.waking(ts, pid);
    } else if (kind === 11) {
      let state = -1;
      let cpuId = -1;
      this.each(b, (f, wt) => {
        if (f === 1 && wt === 0) state = b.varint();
        else if (f === 2 && wt === 0) cpuId = b.varint();
        else return false;
        return true;
      });
      if (state >= 0 && cpuId >= 0) this.b.counter(`cpufreq:${cpuId}`, ts, state, { label: `CPU ${cpuId} freq (kHz)`, cpu: cpuId });
    }
  }

  private compactSched(r: Reader, cpu: number, shift: number | null): void {
    const intern: string[] = [];
    let times: number[] = [];
    let pids: number[] = [];
    let comms: number[] = [];
    let states: number[] = [];
    let wakeTimes: number[] = [];
    let wakePids: number[] = [];
    let waking = 0;
    const packed = (f: (p: Reader) => number): number[] => {
      const p = this.sub(r);
      const out: number[] = [];
      while (p.pos < p.end) out.push(f(p));
      return out;
    };
    this.each(r, (f, wt) => {
      if (f === 5 && wt === 2) intern.push(this.text(r));
      else if (f === 1 && wt === 2) times = packed((p) => p.varint());
      else if (f === 3 && wt === 2) pids = packed((p) => p.int32());
      else if (f === 6 && wt === 2) comms = packed((p) => p.varint());
      else if (f === 2 && wt === 2) states = packed((p) => p.int64());
      else if (f === 8 && wt === 2) wakePids = packed((p) => p.int32());
      else if (f === 7 && wt === 2) {
        const p = this.sub(r);
        let t = 0;
        while (p.pos < p.end) {
          t += p.varint();
          wakeTimes.push(t + (shift ?? 0));
          if (shift !== null && waking === 0) this.ts(t + shift);
          waking++;
        }
        if (waking && shift !== null) this.ts(t + shift);
      } else return false;
      return true;
    });
    const n = times.length;
    if (n) {
      this.s.ftraceTotal += n;
      bump(this.s.ftrace, "sched_switch", n);
    }
    if (waking) {
      this.s.ftraceTotal += waking;
      bump(this.s.ftrace, "sched_waking", waking);
    }
    if (shift === null) return;
    let t = shift;
    for (let i = 0; i < n; i++) {
      t += times[i]!;
      if (i === 0 || i === n - 1) this.ts(t);
      const pid = pids[i] ?? -1;
      if (pid < 0) continue;
      const comm = intern[comms[i] ?? -1];
      if (pid > 0 && comm && !this.b.threads.get(pid)?.name) this.b.thread(pid, undefined, comm);
      this.b.switchTo(cpu, t, pid, states[i] !== undefined ? kernelState(states[i]!) : -1);
    }
    for (let i = 0; i < wakeTimes.length; i++) this.b.waking(wakeTimes[i]!, wakePids[i] ?? -1);
  }

  private proc(pid: number): ProcessInfo {
    let p = this.s.processes.get(pid);
    if (!p) {
      p = { pid };
      this.s.processes.set(pid, p);
    }
    return p;
  }

  private thread(tid: number): ThreadInfo {
    let t = this.s.threads.get(tid);
    if (!t) {
      t = { tid };
      this.s.threads.set(tid, t);
    }
    return t;
  }

  private processTree(r: Reader): void {
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 2) {
        const p = this.sub(r);
        let pid = -1;
        let ppid: number | undefined;
        let uid: number | undefined;
        const cmd: string[] = [];
        this.each(p, (pf, pwt) => {
          if (pf === 1 && pwt === 0) pid = p.int32();
          else if (pf === 2 && pwt === 0) ppid = p.int32();
          else if (pf === 3 && pwt === 2) cmd.push(this.text(p));
          else if (pf === 5 && pwt === 0) uid = p.int32();
          else return false;
          return true;
        });
        if (pid < 0) return true;
        const info = this.proc(pid);
        if (ppid !== undefined) info.ppid = ppid;
        if (uid !== undefined) info.uid = uid;
        if (cmd.length) {
          info.cmdline = cmd.join(" ");
          info.name ??= cmd[0]!.split("/").pop();
        }
        this.b.process(pid, info.name);
        return true;
      }
      if (f === 2 && wt === 2) {
        const t = this.sub(r);
        let tid = -1;
        let tgid: number | undefined;
        let name: string | undefined;
        this.each(t, (tf, twt) => {
          if (tf === 1 && twt === 0) tid = t.int32();
          else if (tf === 3 && twt === 0) tgid = t.int32();
          else if (tf === 2 && twt === 2) name = this.text(t);
          else return false;
          return true;
        });
        if (tid < 0) return true;
        const info = this.thread(tid);
        if (tgid !== undefined) info.pid = tgid;
        if (name) info.name = name;
        this.b.thread(tid, tgid, name);
        return true;
      }
      return false;
    });
  }

  private processStats(r: Reader): void {
    this.each(r, (f, wt) => {
      if (f !== 1 || wt !== 2) return false;
      const p = this.sub(r);
      let pid = -1;
      let rss = -1;
      this.each(p, (pf, pwt) => {
        if (pf === 1 && pwt === 0) pid = p.int32();
        else if (pf === 3 && pwt === 0) rss = p.varint();
        else return false;
        return true;
      });
      if (pid >= 0 && rss >= 0) {
        const info = this.proc(pid);
        if (info.rssKb === undefined || rss > info.rssKb) info.rssKb = rss;
      }
      return true;
    });
  }

  private processDescriptor(r: Reader): number {
    let pid = -1;
    let name: string | undefined;
    const cmd: string[] = [];
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) pid = r.int32();
      else if (f === 2 && wt === 2) cmd.push(this.text(r));
      else if (f === 6 && wt === 2) name = this.text(r);
      else return false;
      return true;
    });
    if (pid < 0) return pid;
    const info = this.proc(pid);
    if (name) info.name = name;
    if (cmd.length) {
      info.cmdline = cmd.join(" ");
      info.name ??= cmd[0]!.split("/").pop();
    }
    this.b.process(pid, info.name);
    return pid;
  }

  private threadDescriptor(r: Reader, seq?: SeqState): [number, number | undefined] {
    let pid: number | undefined;
    let tid = -1;
    let name: string | undefined;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) pid = r.int32();
      else if (f === 2 && wt === 0) tid = r.int32();
      else if (f === 5 && wt === 2) name = this.text(r);
      else if (f === 6 && wt === 0 && seq) seq.refUs = r.int64();
      else if (f === 7 && wt === 0 && seq) seq.refTtUs = r.int64();
      else return false;
      return true;
    });
    if (tid < 0) return [tid, pid];
    const info = this.thread(tid);
    if (pid !== undefined) info.pid = pid;
    if (name) info.name = name;
    this.b.thread(tid, pid, name);
    if (seq) seq.tid = tid; // legacy: the sequence's events belong to this thread
    return [tid, pid];
  }

  private trackDescriptor(r: Reader): void {
    let uuid = "";
    const d: TrackDesc = { counter: false, incremental: false };
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) uuid = r.idKey();
      else if (f === 5 && wt === 0) d.parent = r.idKey();
      else if ((f === 2 || f === 10 || f === 13) && wt === 2) d.name = this.text(r);
      else if (f === 3 && wt === 2) {
        const pid = this.processDescriptor(this.sub(r));
        if (pid >= 0) d.pid = pid;
      } else if (f === 4 && wt === 2) {
        const [tid, pid] = this.threadDescriptor(this.sub(r));
        if (tid >= 0) d.tid = tid;
        if (pid !== undefined) d.pid = pid;
      } else if (f === 8 && wt === 2) {
        d.counter = true;
        const c = this.sub(r);
        this.each(c, (cf, cwt) => {
          if (cf === 5 && cwt === 0) d.incremental = c.varint() > 0;
          else return false;
          return true;
        });
      } else return false;
      return true;
    });
    if (!uuid) return;
    this.tracks.set(uuid, d);
  }

  private clockSnapshot(r: Reader, seq: SeqState): void {
    const clocks = new Map<number, { t: number; inc: boolean; mult: number }>();
    let primary = BOOTTIME;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 2) {
        const c = this.sub(r);
        let id = 0;
        let t = 0;
        let inc = false;
        let mult = 1;
        this.each(c, (cf, cwt) => {
          if (cf === 1 && cwt === 0) id = c.varint();
          else if (cf === 2 && cwt === 0) t = c.varint();
          else if (cf === 3 && cwt === 0) inc = c.varint() > 0;
          else if (cf === 4 && cwt === 0) mult = c.varint() || 1;
          else return false;
          return true;
        });
        clocks.set(id, { t, inc, mult });
      } else if (f === 2 && wt === 0) primary = r.varint();
      else return false;
      return true;
    });
    const p = clocks.get(primary);
    // A sequence clock is defined against whichever global clock its snapshot carries.
    let baseClock = p ? primary : -1;
    for (const id of clocks.keys()) if (baseClock < 0 && id < 64) baseClock = id;
    const base = clocks.get(baseClock);
    for (const [id, c] of clocks) {
      if (id >= 64) {
        if (base) seq.clocks.set(id, { ref: c.t, base: base.t, baseClock, mult: c.mult, incremental: c.inc, last: c.t });
      } else if (p && !this.offsets.has(id)) this.offsets.set(id, p.t - c.t);
    }
    if (!p) return;
    if (!this.wall) {
      this.primary = primary;
      const realtime = clocks.get(1)?.t;
      if (realtime) this.wall = { realtime, primary: p.t };
    }
  }

  /** Legacy µs timestamps (deltas add up on the sequence) on the trace clock, in ns. */
  private legacyTime(us: number): number | null {
    const ns = us * 1000;
    // Chrome wrote them on CLOCK_MONOTONIC.
    const off = this.primary === 3 ? 0 : this.offsets.get(3);
    return off === undefined ? ns : ns + off;
  }

  private trackEvent(r: Reader, seq: SeqState, packetTs: number | null, trustedPid: number): void {
    let type = 0;
    let name: string | undefined;
    let iid = 0;
    let track: string | null = null;
    let value: number | null = null;
    let legacy: Reader | null = null;
    let deltaUs: number | null = null;
    let absUs: number | null = null;
    let ttDelta: number | null = null;
    let ttAbs: number | null = null;
    const flows: string[] = [];
    const ends: string[] = [];
    const anns: Reader[] = [];
    const fixed = (into: string[], prefix: string, wt: number) => {
      // fixed64 ids, one by one or packed
      const read = (rr: Reader) => {
        if (rr.pos + 8 > rr.end) throw new Malformed();
        const dv = new DataView(rr.buf.buffer, rr.buf.byteOffset + rr.pos, 8);
        into.push(`${prefix}${dv.getUint32(4, true)}:${dv.getUint32(0, true)}`);
        rr.pos += 8;
      };
      if (wt === 1) read(r);
      else {
        const p = this.sub(r);
        while (p.pos < p.end) read(p);
      }
    };
    const vints = (into: string[], prefix: string, wt: number) => {
      if (wt === 0) into.push(prefix + r.idKey());
      else {
        const p = this.sub(r);
        while (p.pos < p.end) into.push(prefix + p.idKey());
      }
    };
    this.each(r, (f, wt) => {
      if (f === 9 && wt === 0) type = r.varint();
      else if (f === 6 && wt === 2) legacy = this.sub(r);
      else if (f === 23 && wt === 2) name = this.text(r);
      else if (f === 10 && wt === 0) iid = r.varint();
      else if (f === 11 && wt === 0) track = r.idKey();
      else if (f === 30 && wt === 0) value = r.int64();
      else if (f === 44 && wt === 1) value = r.double();
      else if (f === 4 && wt === 2) anns.push(this.sub(r));
      else if (f === 1 && wt === 0) deltaUs = r.int64();
      else if (f === 16 && wt === 0) absUs = r.int64();
      else if (f === 2 && wt === 0) ttDelta = r.int64();
      else if (f === 17 && wt === 0) ttAbs = r.int64();
      else if ((f === 47 || f === 48) && (wt === 1 || wt === 2)) fixed(f === 47 ? flows : ends, "f:", wt);
      else if ((f === 36 || f === 42) && (wt === 0 || wt === 2)) vints(f === 36 ? flows : ends, "f:", wt);
      else return false;
      return true;
    });
    // Before packet timestamps, a TrackEvent carried its own, relative to its thread descriptor.
    let ts = packetTs;
    if (deltaUs !== null && seq.refUs !== null) ts = this.legacyTime((seq.refUs += deltaUs as number));
    else if (absUs !== null) ts = this.legacyTime(absUs);
    if (ts === null) return;
    let tt: number | null = null;
    if (ttDelta !== null && seq.refTtUs !== null) tt = seq.refTtUs += ttDelta as number;
    else if (ttAbs !== null) tt = ttAbs;
    if (legacy && !type) {
      this.legacyEvent(legacy, seq, ts, trustedPid, name, iid, anns, track, tt, flows, ends);
      return;
    }
    // A typed event can still carry a v1 flow in its legacy_event.
    if (legacy) this.legacyFlow(legacy, flows, ends);
    if (name === undefined && iid) name = seq.names.get(iid) ?? `#${iid}`;
    if (track === "0:0") track = null;
    const key = this.trackKey(track ?? seq.track, seq);
    if (!key) return;
    const b = this.b;
    if (type === 4) {
      if (value === null) return;
      const uuid = track ?? seq.track;
      const desc = uuid ? this.tracks.get(uuid) : undefined;
      let v = value as number;
      if (desc?.incremental) {
        v = (this.incCounters.get(key) ?? 0) + v;
        this.incCounters.set(key, v);
      }
      b.counter(key, ts, v, desc?.pid !== undefined ? { pid: desc.pid, label: desc.name } : { label: desc?.name });
      return;
    }
    if (type === 2) {
      b.end(key, ts, tt ?? -1);
      return;
    }
    const nameId = b.name(name ?? "");
    const arg = anns.length ? b.arg(anns.map((a) => this.annotation(a, seq)).join("\n")) : -1;
    let sid = -1;
    if (type === 1) sid = b.begin(key, key, ts, nameId, arg, tt ?? -1);
    else if (type === 3) sid = b.slice(key, ts, 0, nameId, arg);
    this.flowIds(sid, ts, flows, ends);
  }

  private flowIds(sid: number, ts: number, flows: string[], ends: string[]): void {
    for (const id of flows) this.b.flowId(id, sid, ts);
    for (const id of ends) this.b.flowId(id, sid, ts, true);
  }

  /** A TrackEvent without a type: the phase of its legacy_event (Chrome's JSON phases) says what it is. */
  private legacyEvent(r: Reader, seq: SeqState, ts: number, trustedPid: number, name: string | undefined, iid: number, anns: Reader[], track: string | null, tt: number | null, flows: string[], ends: string[]): void {
    let phase = 0;
    let dur = 0;
    let tdur = -1;
    let id = "";
    let scope = "";
    let pid = trustedPid;
    let bind = "";
    let enclosing = false;
    let direction = 0;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) iid = r.varint();
      else if (f === 2 && wt === 0) phase = r.int32();
      else if (f === 3 && wt === 0) dur = r.int64();
      else if (f === 4 && wt === 0) tdur = r.int64();
      else if ((f === 6 || f === 10 || f === 11) && wt === 0) id = `${f === 10 ? "l" : "g"}:${r.idKey()}`;
      else if (f === 7 && wt === 2) scope = this.text(r);
      else if (f === 18 && wt === 0) pid = r.int32();
      else if (f === 8 && wt === 0) bind = r.idKey();
      else if (f === 12 && wt === 0) enclosing = r.varint() > 0;
      else if (f === 13 && wt === 0) direction = r.varint();
      else return false;
      return true;
    });
    if (name === undefined && iid) name = seq.names.get(iid) ?? `#${iid}`;
    const b = this.b;
    const ph = String.fromCharCode(phase);
    // An explicit track uuid of 0 means "no track": such events belong to the sequence's thread.
    const own = track && track !== "0:0" ? track : null;
    const key = this.trackKey(own ?? seq.track, seq);
    const arg = () => {
      const lines = anns.map((a) => this.annotation(a, seq));
      if (tdur >= 0) lines.push(`thread_duration_us: ${tdur}`);
      return lines.length ? b.arg(lines.join("\n")) : -1;
    };
    this.addV1Flow(bind, direction, flows, ends);
    if (ph === "B" || ph === "E" || ph === "X" || ph === "I" || ph === "i" || ph === "R") {
      if (!key) return;
      let sid = -1;
      if (ph === "E") b.end(key, ts, tt ?? -1);
      else if (ph === "B") sid = b.begin(key, key, ts, b.name(name ?? ""), arg(), tt ?? -1);
      else sid = b.slice(key, ts, ph === "X" ? Math.max(0, dur * 1000) : 0, b.name(name ?? ""), arg());
      this.flowIds(sid, ts, flows, ends);
      return;
    }
    if ((ph === "s" || ph === "t" || ph === "f") && key) {
      // Flow v1 steps bind to the slice around them; an end without bind_to_enclosing, to the next.
      b.flowPoint(`p:${scope}:${id}`, key, ts, ph === "s" ? 0 : ph === "t" ? 1 : 2, ph === "f" && !enclosing);
      return;
    }
    if ("beSFnT".includes(ph) && pid > 0) {
      // Async events: a track per id in the process, named after its first slice; tracks of
      // one name share a row. An end may be unnamed: it closes the id's innermost slice.
      // A local id is the process's own; unscoped and global ones match across processes.
      const label = name ?? "";
      const track = `a:${pid}:${scope}:${id}`;
      const match = id.startsWith("l:") ? track : `a:g:${scope}:${id}`;
      b.describe(track, { pid });
      let sid = -1;
      if (ph === "b" || ph === "S") sid = b.begin(match, track, ts, b.name(label), arg());
      else if (ph === "e" || ph === "F") b.end(match, ts);
      else sid = b.slice(track, ts, 0, b.name(label), arg());
      this.flowIds(sid, ts, flows, ends);
    }
  }

  /** Flow v1: a bind id with a direction (out starts or continues a flow, in ends it). */
  private addV1Flow(bind: string, direction: number, flows: string[], ends: string[]): void {
    if (!bind || !direction) return;
    if (direction === 1) ends.push(`b:${bind}`);
    else flows.push(`b:${bind}`);
  }

  private legacyFlow(r: Reader, flows: string[], ends: string[]): void {
    let bind = "";
    let direction = 0;
    this.each(r, (f, wt) => {
      if (f === 8 && wt === 0) bind = r.idKey();
      else if (f === 13 && wt === 0) direction = r.varint();
      else return false;
      return true;
    });
    this.addV1Flow(bind, direction, flows, ends);
  }

    /** The builder key for a track uuid (described now or later), or the sequence's thread. */
  private trackKey(uuid: string | null, seq: SeqState): string | null {
    if (uuid) {
      const key = `u:${uuid}`;
      if (!this.described.has(uuid)) {
        const d = this.tracks.get(uuid);
        if (d) {
          this.describeTrack(key, d);
          this.described.add(uuid);
        }
      }
      return key;
    }
    return seq.tid !== null ? `t:${seq.tid}` : null;
  }

  private describeTrack(key: string, d: TrackDesc): void {
    if (d.tid !== undefined && !d.counter) {
      this.b.alias(key, `t:${d.tid}`);
      return;
    }
    let pid = d.pid;
    // A track with no process of its own belongs to its parent's.
    for (let p = d.parent, i = 0; pid === undefined && p && i < 8; i++) {
      const parent = this.tracks.get(p);
      pid = parent?.pid ?? (parent?.tid !== undefined ? this.b.threads.get(parent.tid)?.pid : undefined);
      p = parent?.parent;
    }
    this.b.describe(key, { label: d.name ?? "", ...(pid !== undefined ? { pid } : {}) });
  }

  private annotation(r: Reader, seq: SeqState): string {
    let name = "";
    let value = "";
    this.each(r, (f, wt) => {
      if (f === 10 && wt === 2) name = this.text(r);
      else if (f === 1 && wt === 0) name = seq.annNames.get(r.varint()) ?? "";
      else if (f === 2 && wt === 0) value = r.varint() ? "true" : "false";
      else if (f === 3 && wt === 0) value = String(r.varint());
      else if (f === 4 && wt === 0) value = String(r.int64());
      else if (f === 5 && wt === 1) value = String(r.double());
      else if ((f === 6 || f === 9) && wt === 2) value = this.text(r);
      else if (f === 17 && wt === 0) value = seq.annStrings.get(r.varint()) ?? "";
      else if (f === 7 && wt === 0) value = "0x" + r.varint().toString(16);
      else if ((f === 11 || f === 12) && wt === 2) {
        const inner = this.annotation(this.sub(r), seq);
        value = value ? `${value}, ${inner}` : inner;
      } else return false;
      return true;
    });
    return name ? `${name}: ${value}` : value;
  }

  private internedData(r: Reader, seq: SeqState): void {
    this.each(r, (f, wt) => {
      if (wt !== 2 || (f !== 2 && f !== 3 && f !== 29)) return false;
      const e = this.sub(r);
      let iid = 0;
      let name = "";
      this.each(e, (ef, ewt) => {
        if (ef === 1 && ewt === 0) iid = e.varint();
        else if (ef === 2 && ewt === 2) name = this.text(e);
        else return false;
        return true;
      });
      const m = f === 2 ? seq.names : f === 3 ? seq.annNames : seq.annStrings;
      if (m.size < 200_000) m.set(iid, name);
      return true;
    });
  }

  private androidLog(r: Reader): void {
    const s = this.s;
    this.each(r, (f, wt) => {
      if (f !== 1 || wt !== 2) return false;
      const e = this.sub(r);
      s.logTotal++;
      if (s.logs.length >= LOG_CAP) return true;
      const entry: LogEntry = { ts: 0, pid: 0, tid: 0, prio: 0, tag: "", msg: "" };
      const args: string[] = [];
      this.each(e, (lf, lwt) => {
        if (lf === 2 && lwt === 0) entry.pid = e.int32();
        else if (lf === 3 && lwt === 0) entry.tid = e.int32();
        else if (lf === 5 && lwt === 0) entry.ts = e.varint();
        else if (lf === 6 && lwt === 2) entry.tag = this.text(e);
        else if (lf === 7 && lwt === 0) entry.prio = e.varint();
        else if (lf === 8 && lwt === 2) entry.msg = this.text(e);
        else if (lf === 9 && lwt === 2) args.push(this.logArg(this.sub(e)));
        else return false;
        return true;
      });
      if (!entry.msg && args.length) entry.msg = args.join(" ");
      s.logs.push(entry);
      return true;
    });
  }

  /** Power rails: cumulative energy (µWs) per rail, named by the descriptors. */
  private powerRails(r: Reader, packetTs: number | null): void {
    this.each(r, (f, wt) => {
      if (wt !== 2 || (f !== 1 && f !== 2)) return false;
      const e = this.sub(r);
      let index = 0;
      let name = "";
      let ms = 0;
      let energy = -1;
      this.each(e, (ef, ewt) => {
        if (ef === 1 && ewt === 0) index = e.varint();
        else if (f === 1 && ef === 2 && ewt === 2) name = this.text(e);
        else if (f === 2 && ef === 2 && ewt === 0) ms = e.varint();
        else if (f === 2 && ef === 3 && ewt === 0) energy = e.varint();
        else return false;
        return true;
      });
      if (f === 1) {
        if (name) this.b.describe(`rail:${index}`, { label: `power.rails.${name.toLowerCase()}` });
      } else if (energy >= 0) {
        // The packet's time is on the trace clock; timestamp_ms only stands in without one.
        const ts = packetTs ?? (ms > 0 ? ms * 1e6 : null);
        if (ts !== null) this.b.counter(`rail:${index}`, ts, energy, { label: `power.rails.${index}` });
      }
      return true;
    });
  }

    private logArg(r: Reader): string {
    let name = "";
    let value = "";
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 2) name = this.text(r);
      else if (f === 2 && wt === 0) value = String(r.int64());
      else if (f === 3 && wt === 5) {
        value = String(new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 4).getFloat32(0, true));
        r.pos += 4;
      } else if (f === 4 && wt === 2) value = this.text(r);
      else return false;
      return true;
    });
    return name ? `${name}=${value}` : value;
  }

  private systemInfo(r: Reader): void {
    const info: SystemInfo = this.s.system ?? {};
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 2) {
        const u = this.sub(r);
        const parts: string[] = [];
        this.each(u, (uf, uwt) => {
          if (uwt === 2 && (uf === 1 || uf === 3 || uf === 4)) parts[uf] = this.text(u);
          else return false;
          return true;
        });
        info.kernel = parts.filter(Boolean).join(" ");
      } else if (f === 2 && wt === 2) info.fingerprint = this.text(r);
      else if (f === 14 && wt === 2) info.manufacturer = this.text(r);
      else if (f === 9 && wt === 2) info.soc = this.text(r);
      else if (f === 4 && wt === 2) info.service = this.text(r);
      else if (f === 5 && wt === 0) info.sdk = r.varint();
      else if (f === 8 && wt === 0) info.cpus = r.varint();
      else return false;
      return true;
    });
    this.s.system = info;
  }

  private compressed(bytes: Uint8Array, inflate: Inflate): void {
    let inner: Uint8Array;
    try {
      inner = inflate(bytes);
    } catch {
      this.s.badCompressed++;
      return;
    }
    this.nested++;
    try {
      this.packets(inner, 0, inner.length, () => false);
    } catch (e) {
      if (e instanceof Malformed || e instanceof StopAt) this.s.badCompressed++;
      else throw e;
    } finally {
      this.nested--;
    }
  }

  finish(): TraceModel {
    const s = this.s;
    // Descriptors that arrived after their first event still name their track.
    for (const [uuid, d] of this.tracks) this.describeTrack(`u:${uuid}`, d);
    // Logcat times are on CLOCK_REALTIME: they move to the trace clock once a snapshot has
    // given its offset, and are left out of the bounds without one.
    const real = this.primary === 1 ? 0 : this.offsets.get(1);
    for (const l of s.logs) {
      if (!(l.ts > 0)) continue;
      if (real === undefined) l.ts = 0;
      else {
        l.ts += real;
        this.b.time(l.ts);
      }
    }
    // The trace spans what the timeline draws (slices, CPU slices, counters, log lines); packet
    // timestamps of metadata only stand in when there is nothing to draw.
    const empty = this.b.empty;
    const model = this.b.finish();
    if (!empty) {
      s.firstTs = model.start;
      s.lastTs = model.end;
    }
    if (this.wall && s.firstTs !== null) s.wallStartMs = (this.wall.realtime + (s.firstTs - this.wall.primary)) / 1e6;
    return model;
  }
}

export interface ParsedTrace {
  summary: TraceSummary;
  model: TraceModel;
}

const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

/**
 * Reads the whole trace in time slices (about 12 ms each) so the page stays responsive.
 * `onProgress` sees the summary as it fills; `cancelled` stops early.
 */
/** The zstd decoder, a chunk of its own that only zstd traces load. */
const loadZstd = (): Promise<Inflate> => import("fzstd").then((m) => (b: Uint8Array) => m.decompress(b));

export async function parseTrace(
  bytes: Uint8Array,
  opts: { onProgress?: (s: TraceSummary) => void; cancelled?: () => boolean; slice?: number; zstd?: () => Promise<Inflate> } = {},
): Promise<ParsedTrace> {
  const s = emptySummary(bytes.length);
  const p = new TraceParser(s, new ModelBuilder());
  const slice = opts.slice ?? 12;
  let pos = 0;
  while (pos < bytes.length) {
    const t0 = performance.now();
    let n = 0;
    try {
      pos = p.packets(bytes, pos, bytes.length, () => (++n & 63) === 0 && performance.now() - t0 > slice);
    } catch (e) {
      if (e instanceof NeedZstd) {
        pos = e.at;
        p.askZstd = false;
        try {
          p.zstd = await (opts.zstd ?? loadZstd)();
        } catch {
          p.zstd = null; // offline, say: the packets are counted as skipped
        }
        continue;
      }
      if (e instanceof StopAt) s.stoppedAt = e.at;
      else throw e;
      break;
    }
    s.read = pos;
    if (pos >= bytes.length) break;
    opts.onProgress?.(s);
    await tick();
    if (opts.cancelled?.()) break;
  }
  s.read = s.stoppedAt ?? pos;
  return { summary: s, model: p.finish() };
}

/** Synchronous variant, for tests and small inputs; zstd packets need `zstd`. */
export function parseTraceSync(bytes: Uint8Array, zstd?: Inflate): ParsedTrace {
  const s = emptySummary(bytes.length);
  const p = new TraceParser(s, new ModelBuilder());
  p.zstd = zstd ?? null;
  p.askZstd = false;
  try {
    s.read = p.packets(bytes, 0, bytes.length, () => false);
  } catch (e) {
    if (e instanceof StopAt) s.stoppedAt = e.at;
    else throw e;
  }
  return { summary: s, model: p.finish() };
}
