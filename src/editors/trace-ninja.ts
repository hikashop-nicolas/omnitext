import { t } from "../i18n";
import type { ModelBuilder } from "./trace-model";
import { tally, type TraceStats } from "./trace-stats";

// Ninja build logs (.ninja_log, versions 5 to 7): "# ninja log vN" then one line per output,
//   start_ms <TAB> end_ms <TAB> mtime <TAB> output <TAB> command hash
// with times from the start of the build. As Perfetto does, outputs of one command (same hash
// and times, back to back) make one step, and steps are packed onto inferred parallel workers.

export const NINJA_PID = 1;

interface Step {
  start: number;
  end: number;
  hash: string;
  names: string[];
}

/** Reads the log into the builder; returns its figures for the Overview. */
export function readNinjaInto(b: ModelBuilder, text: string): TraceStats {
  const steps: Step[] = [];
  let version = 0;
  let bad = 0;
  let outputs = 0;
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos);
    if (nl < 0) nl = text.length;
    const line = text.slice(pos, nl).replace(/\r+$/, "");
    pos = nl + 1;
    if (!line) continue;
    if (line.startsWith("#")) {
      const v = /^# ninja log v(\d+)/.exec(line);
      if (v) version = Number(v[1]);
      continue;
    }
    const f = line.split("\t");
    const start = Number(f[0]);
    const end = Number(f[1]);
    const name = f[3];
    const hash = f[4] ?? "";
    if (f.length < 5 || !Number.isFinite(start) || !Number.isFinite(end) || !name) {
      bad++;
      continue;
    }
    outputs++;
    const last = steps[steps.length - 1];
    if (last && last.hash === hash && last.start === start && last.end === end) last.names.push(name);
    else steps.push({ start, end, hash, names: [name] });
  }
  steps.sort((a, b) => a.start - b.start);
  // Each step goes to the worker that freed up last before it started, else to a new one.
  const busy: number[] = [];
  b.process(NINJA_PID, "ninja");
  let cpu = 0;
  let lo = Infinity;
  let hi = -Infinity;
  const byExt = new Map<string, [number, number]>();
  const slowest: Step[] = [];
  for (const s of steps) {
    let w = -1;
    for (let i = 0; i < busy.length; i++) if (busy[i]! <= s.start && (w < 0 || busy[i]! > busy[w]!)) w = i;
    if (w < 0) {
      w = busy.length;
      busy.push(0);
      b.thread(w + 1, NINJA_PID, t("perfetto.ninjaWorker"));
    }
    busy[w] = Math.max(s.end, s.start);
    const dur = Math.max(0, s.end - s.start);
    const arg = [s.names.length > 1 ? `outputs: ${s.names.join("\n  ")}` : `output: ${s.names[0]}`, `hash: ${s.hash}`].join("\n");
    b.slice(`t:${w + 1}`, s.start * 1e6, dur * 1e6, b.name(s.names.join(" ")), b.arg(arg));
    cpu += dur;
    lo = Math.min(lo, s.start);
    hi = Math.max(hi, s.end);
    const ext = /\.([A-Za-z0-9_+-]{1,12})$/.exec(s.names[0]!.replace(/^.*\//, ""))?.[1] ?? "";
    const e = byExt.get(ext) ?? [0, 0];
    e[0]++;
    e[1] += dur * 1e6;
    byExt.set(ext, e);
    slowest.push(s);
  }
  slowest.sort((a, c) => c.end - c.start - (a.end - a.start));
  const wall = steps.length ? hi - lo : 0;
  const stats: TraceStats = {
    facts: [
      { key: "ninjaVersion", value: version ? String(version) : "?", kind: "text" },
      { key: "ninjaSteps", value: steps.length, kind: "count" },
      { key: "ninjaOutputs", value: outputs, kind: "count" },
      { key: "ninjaCpu", value: cpu * 1e6, kind: "dur" },
      { key: "ninjaParallelism", value: wall > 0 ? (cpu / wall).toFixed(1) : "0", kind: "text" },
      { key: "ninjaWorkers", value: busy.length, kind: "count" },
    ],
    tables: [
      {
        title: "ninjaSlowest",
        cols: [{ key: "name", kind: "text" }, { key: "detailDuration", kind: "dur" }],
        rows: slowest.slice(0, 50).map((s) => [s.names.join(" "), (s.end - s.start) * 1e6]),
        bar: 1,
      },
      {
        title: "ninjaByType",
        cols: [{ key: "ninjaType", kind: "text" }, { key: "count", kind: "count" }, { key: "ninjaTotal", kind: "dur" }],
        rows: tally(byExt, 2).map((r) => [r[0] ? `.${r[0]}` : "", r[1]!, r[2]!]),
        bar: 2,
      },
    ],
  };
  if (bad) stats.facts.push({ key: "linesSkipped", value: bad, kind: "count" });
  return stats;
}
