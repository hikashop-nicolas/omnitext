import { unzlibSync } from "fflate";
import { ctraceStart } from "../formats/trace-detect";
import { bytesKind, entryKind, textKind, type TraceKind } from "../formats/trace-kind";
import { emptySummary, parseTraceInto, type TraceSummary } from "./perfetto-parse";
import { ModelBuilder, type TraceModel } from "./trace-model";
import { readChromeInto } from "./trace-chrome";
import { readSystraceInto, systraceBlocks } from "./trace-systrace";
import { readNinjaInto } from "./trace-ninja";
import { readStraceInto } from "./trace-strace";
import { logcatWallTimes, readLogcatInto, type LogcatAlign } from "./trace-logcat";
import { readFuchsiaInto } from "./trace-fuchsia";
import type { TraceStats } from "./trace-stats";

// Picks the reader for a trace's text or bytes and fills one model; an archive's traces all go
// into the same builder, so they share one timeline.

export type { TraceKind };

export interface ArchiveFile {
  name: string;
  kind: TraceKind | null;
}

export interface LoadedTrace {
  kind: TraceKind;
  summary: TraceSummary;
  model: TraceModel;
  stats: TraceStats | null;
  /** For an archive: each file and how it was read (null: not a trace). */
  files?: ArchiveFile[];
}

export interface LoadOpts {
  onProgress?: (percent: number) => void;
  cancelled?: () => boolean;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Ctx {
  b: ModelBuilder;
  s: TraceSummary;
  stats: TraceStats | null;
  realtime?: number;
}

const decodeText = (b: Uint8Array): string => new TextDecoder().decode(b);

async function readText(c: Ctx, kind: TraceKind, text: string, align?: LogcatAlign | null): Promise<void> {
  if (kind === "json") await readChromeInto(c.b, JSON.parse(text) as unknown);
  else if (kind === "ninja") c.stats = readNinjaInto(c.b, text);
  else if (kind === "strace") {
    const r = readStraceInto(c.b, text);
    c.stats = r.stats;
    c.s.wallStartMs ??= r.wallStartMs;
  } else if (kind === "logcat") {
    const r = readLogcatInto(c.b, text, c.s, align);
    c.stats = r.stats;
    if (!align) c.s.wallStartMs ??= r.wallStartMs;
  } else {
    const blocks = systraceBlocks(text);
    for (const block of blocks.ftrace) c.s.ftraceTotal += await readSystraceInto(c.b, block, c.s.ftrace, c.s.cpus);
    for (const j of blocks.json) {
      try {
        await readChromeInto(c.b, JSON.parse(j));
      } catch {
        /* a damaged block leaves the rest */
      }
    }
  }
}

async function readBytes(c: Ctx, kind: TraceKind, bytes: Uint8Array, opts: LoadOpts): Promise<void> {
  if (kind === "perfetto") {
    const real = await parseTraceInto(bytes, c.b, c.s, {
      onProgress: (s) => opts.onProgress?.(Math.floor((s.read / Math.max(1, bytes.length)) * 100)),
      cancelled: opts.cancelled,
    });
    if (real !== undefined && c.realtime === undefined) c.realtime = real;
  } else if (kind === "fuchsia") c.stats = readFuchsiaInto(c.b, bytes, c.s);
  else if (kind === "ctrace") {
    const z = ctraceStart(bytes);
    const text = decodeText(unzlibSync(bytes.subarray(z)));
    c.s.ftraceTotal += await readSystraceInto(c.b, text, c.s.ftrace, c.s.cpus);
  }
}

/** Fills summary times and process lists from what the model knows. */
function close(c: Ctx, kind: TraceKind, files?: ArchiveFile[]): LoadedTrace {
  const model = c.b.finish();
  const s = c.s;
  if (model.end > model.start || s.firstTs === null) {
    s.firstTs = model.start;
    s.lastTs = model.end;
  }
  for (const p of model.processes.values()) if (!s.processes.has(p.pid)) s.processes.set(p.pid, { pid: p.pid, ...(p.name ? { name: p.name } : {}) });
  for (const th of model.threads.values()) if (!s.threads.has(th.tid)) s.threads.set(th.tid, { ...th });
  return { kind, summary: s, model, stats: c.stats, ...(files ? { files } : {}) };
}

export async function loadText(text: string): Promise<LoadedTrace> {
  const kind = textKind(text) ?? (/^\s*[[{]/.test(text) ? "json" : "systrace");
  const c: Ctx = { b: new ModelBuilder(), s: emptySummary(text.length), stats: null };
  await readText(c, kind, text);
  return close(c, kind);
}

export async function loadBytes(bytes: Uint8Array, opts: LoadOpts = {}): Promise<LoadedTrace> {
  const kind = bytesKind(bytes, true) ?? "perfetto";
  const c: Ctx = { b: new ModelBuilder(), s: emptySummary(bytes.length), stats: null };
  await readBytes(c, kind, bytes, opts);
  return close(c, kind);
}

/** Reads every trace of an archive onto one timeline; logcat lines are put on the trace clock. */
export async function loadArchive(entries: { name: string; read: () => Promise<Uint8Array> }[], size: number, opts: LoadOpts = {}): Promise<LoadedTrace> {
  const c: Ctx = { b: new ModelBuilder(), s: emptySummary(size), stats: null };
  const files: ArchiveFile[] = [];
  const later: { name: string; data: Uint8Array; kind: TraceKind }[] = [];
  let done = 0;
  for (const e of entries) {
    if (opts.cancelled?.()) break;
    let got: { kind: TraceKind | null; data: Uint8Array };
    try {
      got = entryKind(e.name, await e.read());
    } catch {
      got = { kind: null, data: new Uint8Array() };
    }
    files.push({ name: e.name, kind: got.kind });
    // Logcat waits for a trace with a clock snapshot, to line up with it.
    if (got.kind === "logcat") later.push({ name: e.name, data: got.data, kind: got.kind });
    else if (got.kind) {
      try {
        if (got.kind === "perfetto" || got.kind === "fuchsia" || got.kind === "ctrace") await readBytes(c, got.kind, got.data, {});
        else await readText(c, got.kind, decodeText(got.data));
      } catch {
        files[files.length - 1]!.kind = null;
      }
    }
    opts.onProgress?.(Math.floor((++done / Math.max(1, entries.length)) * 100));
    await tick();
  }
  for (const l of later) {
    const text = decodeText(l.data);
    let align: LogcatAlign | null = null;
    // Logcat prints the device's local time and Perfetto's realtime clock is UTC: the zone is
    // the quarter hour offset that puts the most lines inside the trace.
    // Logcat leaves the year out: it is the trace's.
    const year = c.realtime !== undefined && c.s.firstTs !== null ? new Date((c.s.firstTs - c.realtime) / 1e6).getUTCFullYear() : undefined;
    const walls = logcatWallTimes(text, 20000, year);
    if (c.realtime !== undefined && walls.length && c.s.firstTs !== null && c.s.lastTs !== null) {
      let best = -1;
      for (let q = -56; q <= 56; q++) {
        const zone = q * 9e5;
        let n = 0;
        for (const w of walls) {
          const ts = (w - zone) * 1e6 + c.realtime;
          if (ts >= c.s.firstTs && ts <= c.s.lastTs) n++;
        }
        if (n > best || (n === best && Math.abs(zone) < Math.abs(align!.wallMs))) {
          best = n;
          align = { wallMs: zone, ts: c.realtime };
        }
      }
    }
    c.stats = readLogcatInto(c.b, text, c.s, align, year).stats;
  }
  const kinds = new Set(files.map((f) => f.kind).filter(Boolean));
  if (kinds.size > 1) c.stats = null;
  return close(c, "archive", files);
}
