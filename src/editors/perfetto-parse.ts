import { decompressSync } from "fflate";
import { FTRACE_EVENTS, PACKET_FIELDS } from "./perfetto-names";

// A summary of a Perfetto trace (a protobuf Trace: repeated TracePacket packet = 1), read
// with a hand-written protobuf reader. Field numbers come from perfetto/protos/perfetto/trace.

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
  atrace: Map<string, number>;
  trackEvents: Map<string, number>;
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
    atrace: new Map(), trackEvents: new Map(), processes: new Map(), threads: new Map(),
    logs: [], logTotal: 0, system: null, zstdPackets: 0, badCompressed: 0, stoppedAt: null,
  };
}

/** Packet field names, `field #N` for numbers this build does not know. */
export const packetFieldName = (n: number): string => PACKET_FIELDS[n] ?? `field #${n}`;
export const ftraceEventName = (n: number): string => FTRACE_EVENTS[n] ?? `event #${n}`;

class TraceParser {
  private clock: { realtime: number; primary: number } | null = null;
  private interned = new Map<number, Map<number, string>>();
  constructor(readonly s: TraceSummary) {}

  private ts(t: number): void {
    if (!(t > 0)) return;
    const s = this.s;
    if (s.firstTs === null || t < s.firstTs) s.firstTs = t;
    if (s.lastTs === null || t > s.lastTs) s.lastTs = t;
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
        throw e;
      }
      if (budget()) return r.pos;
    }
    return r.pos;
  }

  private packet(buf: Uint8Array, start: number, end: number): void {
    const s = this.s;
    s.packets++;
    const r = new Reader(buf, start, end);
    let data = 0;
    let dStart = 0;
    let dEnd = 0;
    let seq = 0;
    let flags = 0;
    let iStart = -1;
    let iEnd = -1;
    let ts = 0;
    try {
      while (r.pos < end) {
        const tag = r.varint();
        const field = tag >>> 3;
        const wt = tag & 7;
        if (field === 8 && wt === 0) ts = r.varint();
        else if (field === 10 && wt === 0) seq = r.varint();
        else if (field === 13 && wt === 0) flags |= r.varint();
        else if (field === 41 && wt === 0) flags |= r.varint() ? 1 : 0;
        else if (field === 12 && wt === 2) {
          iEnd = r.len();
          iStart = r.pos;
          r.pos = iEnd;
        } else if (wt === 2 && !data && field !== 59) {
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
    bump(s.packetTypes, data ? packetFieldName(data) : iStart >= 0 ? "interned_data" : "(empty)");
    this.ts(ts);
    if (flags & 1) this.interned.delete(seq);
    if (iStart >= 0) this.safe(() => this.internedData(new Reader(buf, iStart, iEnd), seq));
    if (!data) return;
    const d = new Reader(buf, dStart, dEnd);
    this.safe(() => {
      switch (data) {
        case 1: return this.ftraceBundle(d);
        case 2: return this.processTree(d);
        case 6: return this.clockSnapshot(d);
        case 9: return this.processStats(d);
        case 11: return this.trackEvent(d, seq);
        case 39: return this.androidLog(d);
        case 43: return this.processDescriptor(d);
        case 44: return this.threadDescriptor(d);
        case 45: return this.systemInfo(d);
        case 50: return this.compressed(buf.subarray(dStart, dEnd));
        case 60: return this.trackDescriptor(d);
        case 133: s.zstdPackets++; return;
      }
    });
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

  private ftraceBundle(r: Reader): void {
    const s = this.s;
    let foreignClock = false;
    const events: Reader[] = [];
    let compact: Reader | null = null;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) s.cpus.add(r.varint());
      else if (f === 2 && wt === 2) events.push(this.sub(r));
      else if (f === 3 && wt === 0) s.lostBundles += r.varint() ? 1 : 0;
      else if (f === 4 && wt === 2) compact = this.sub(r);
      else if (f === 5 && wt === 0) foreignClock = r.varint() > 0;
      else return false;
      return true;
    });
    for (const e of events) this.safe(() => this.ftraceEvent(e, foreignClock));
    if (compact) this.safe(() => this.compactSched(compact!, foreignClock));
  }

  private ftraceEvent(r: Reader, foreignClock: boolean): void {
    let kind = 0;
    let ts = 0;
    let buf: string | null = null;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) ts = r.varint();
      else if (f === 2 || f === 5) return false;
      else if (!kind) {
        kind = f;
        if (f === 3 && wt === 2) {
          const p = this.sub(r);
          this.each(p, (pf, pwt) => {
            if (pf === 2 && pwt === 2) buf = this.text(p);
            else return false;
            return true;
          });
        } else return false;
      } else return false;
      return true;
    });
    if (!kind) return;
    this.s.ftraceTotal++;
    bump(this.s.ftrace, ftraceEventName(kind));
    if (!foreignClock) this.ts(ts);
    if (buf !== null) this.atrace(buf);
  }

  // Android userspace slices arrive as print events: "B|pid|name", "S|pid|name|cookie".
  private atrace(buf: string): void {
    const c = buf.charCodeAt(0);
    if ((c !== 66 && c !== 83) || buf.charCodeAt(1) !== 124) return;
    const a = buf.indexOf("|", 2);
    if (a < 0) return;
    let name = buf.slice(a + 1);
    if (c === 83) {
      const b = name.lastIndexOf("|");
      if (b > 0) name = name.slice(0, b);
    }
    name = name.replace(/\n$/, "");
    if (name) bump(this.s.atrace, name);
  }

  private compactSched(r: Reader, foreignClock: boolean): void {
    this.each(r, (f, wt) => {
      if ((f === 1 || f === 7) && wt === 2) {
        const p = this.sub(r);
        let t = 0;
        let n = 0;
        while (p.pos < p.end) {
          t += p.varint();
          n++;
          if (!foreignClock && n === 1) this.ts(t);
        }
        if (n && !foreignClock) this.ts(t);
        this.s.ftraceTotal += n;
        bump(this.s.ftrace, f === 1 ? "sched_switch" : "sched_waking", n);
        return true;
      }
      return false;
    });
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

  private processDescriptor(r: Reader): void {
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
    if (pid < 0) return;
    const info = this.proc(pid);
    if (name) info.name = name;
    if (cmd.length) {
      info.cmdline = cmd.join(" ");
      info.name ??= cmd[0]!.split("/").pop();
    }
  }

  private threadDescriptor(r: Reader): void {
    let pid: number | undefined;
    let tid = -1;
    let name: string | undefined;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 0) pid = r.int32();
      else if (f === 2 && wt === 0) tid = r.int32();
      else if (f === 5 && wt === 2) name = this.text(r);
      else return false;
      return true;
    });
    if (tid < 0) return;
    const info = this.thread(tid);
    if (pid !== undefined) info.pid = pid;
    if (name) info.name = name;
  }

  private trackDescriptor(r: Reader): void {
    this.each(r, (f, wt) => {
      if (f === 3 && wt === 2) this.processDescriptor(this.sub(r));
      else if (f === 4 && wt === 2) this.threadDescriptor(this.sub(r));
      else return false;
      return true;
    });
  }

  private clockSnapshot(r: Reader): void {
    if (this.clock) return;
    const clocks = new Map<number, number>();
    let primary = 6;
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 2) {
        const c = this.sub(r);
        let id = 0;
        let t = 0;
        this.each(c, (cf, cwt) => {
          if (cf === 1 && cwt === 0) id = c.varint();
          else if (cf === 2 && cwt === 0) t = c.varint();
          else return false;
          return true;
        });
        clocks.set(id, t);
      } else if (f === 2 && wt === 0) primary = r.varint();
      else return false;
      return true;
    });
    const realtime = clocks.get(1);
    const p = clocks.get(primary);
    if (realtime && p !== undefined) this.clock = { realtime, primary: p };
  }

  private trackEvent(r: Reader, seq: number): void {
    let type = 0;
    let name: string | undefined;
    let iid = 0;
    this.each(r, (f, wt) => {
      if (f === 9 && wt === 0) type = r.varint();
      else if (f === 23 && wt === 2) name = this.text(r);
      else if (f === 10 && wt === 0) iid = r.varint();
      else return false;
      return true;
    });
    if (type === 2 || type === 4) return; // slice ends and counters carry no name of their own
    if (name === undefined && iid) name = this.interned.get(seq)?.get(iid);
    if (name !== undefined) bump(this.s.trackEvents, name || "(unnamed)");
    else if (iid) bump(this.s.trackEvents, `#${iid}`);
  }

  private internedData(r: Reader, seq: number): void {
    this.each(r, (f, wt) => {
      if (f !== 2 || wt !== 2) return false;
      const e = this.sub(r);
      let iid = 0;
      let name = "";
      this.each(e, (ef, ewt) => {
        if (ef === 1 && ewt === 0) iid = e.varint();
        else if (ef === 2 && ewt === 2) name = this.text(e);
        else return false;
        return true;
      });
      let m = this.interned.get(seq);
      if (!m) this.interned.set(seq, (m = new Map()));
      if (m.size < 100_000) m.set(iid, name);
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

  private logArg(r: Reader): string {
    let name = "";
    let value = "";
    this.each(r, (f, wt) => {
      if (f === 1 && wt === 2) name = this.text(r);
      else if (f === 2 && wt === 0) value = String(r.int32());
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

  private compressed(bytes: Uint8Array): void {
    let inner: Uint8Array;
    try {
      inner = decompressSync(bytes);
    } catch {
      this.s.badCompressed++;
      return;
    }
    try {
      this.packets(inner, 0, inner.length, () => false);
    } catch (e) {
      if (e instanceof Malformed || e instanceof StopAt) this.s.badCompressed++;
      else throw e;
    }
  }

  finish(): void {
    const s = this.s;
    if (this.clock && s.firstTs !== null) s.wallStartMs = (this.clock.realtime + (s.firstTs - this.clock.primary)) / 1e6;
  }
}

class StopAt extends Error {
  constructor(readonly at: number) {
    super("stop");
  }
}

const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

/**
 * Reads the whole trace in time slices (about 12 ms each) so the page stays responsive.
 * `onProgress` sees the summary as it fills; `cancelled` stops early.
 */
export async function parseTrace(
  bytes: Uint8Array,
  opts: { onProgress?: (s: TraceSummary) => void; cancelled?: () => boolean; slice?: number } = {},
): Promise<TraceSummary> {
  const s = emptySummary(bytes.length);
  const p = new TraceParser(s);
  const slice = opts.slice ?? 12;
  let pos = 0;
  while (pos < bytes.length) {
    const t0 = performance.now();
    let n = 0;
    try {
      pos = p.packets(bytes, pos, bytes.length, () => (++n & 63) === 0 && performance.now() - t0 > slice);
    } catch (e) {
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
  p.finish();
  return s;
}

/** Synchronous variant, for tests and small inputs. */
export function parseTraceSync(bytes: Uint8Array): TraceSummary {
  const s = emptySummary(bytes.length);
  const p = new TraceParser(s);
  try {
    s.read = p.packets(bytes, 0, bytes.length, () => false);
  } catch (e) {
    if (e instanceof StopAt) s.stoppedAt = e.at;
    else throw e;
  }
  p.finish();
  return s;
}
