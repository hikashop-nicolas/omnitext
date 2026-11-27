import type { ModelBuilder } from "./trace-model";

// Android atrace markers, as apps and the system write them to trace_marker:
// "B|pid|name" begin, "E|pid" end, "C|pid|name|value" counter, "I|pid|name" instant,
// "S|pid|name|cookie" / "F|pid|name|cookie" async begin / end.

export function atraceEvent(b: ModelBuilder, ts: number, tid: number, raw: string): boolean {
  const buf = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  const kind = buf.charCodeAt(0);
  if (buf.charCodeAt(1) !== 124 && !(kind === 69 && buf.length === 1)) return false; // "X|" or a bare "E"
  const parts = buf.split("|");
  const pid = Number(parts[1]) || undefined;
  if (tid > 0) b.thread(tid, pid);
  switch (buf[0]) {
    case "B":
      b.begin(`t:${tid}`, `t:${tid}`, ts, b.name(parts.slice(2).join("|")));
      return true;
    case "E":
      b.end(`t:${tid}`, ts);
      return true;
    case "I":
      b.slice(`t:${tid}`, ts, 0, b.name(parts.slice(2).join("|")));
      return true;
    case "C": {
      const value = Number(parts[3]);
      if (!parts[2] || !Number.isFinite(value)) return false;
      const owner = pid ?? tid;
      b.counter(`c:${owner}:${parts[2]}`, ts, value, { label: parts[2], pid: owner });
      return true;
    }
    case "S":
    case "F": {
      const name = parts[2] ?? "";
      const owner = pid ?? tid;
      const track = `a:${owner}:${name}`;
      b.describe(track, { label: name, pid: owner });
      const match = `${track}:${parts[3] ?? ""}`;
      if (buf[0] === "S") b.begin(match, track, ts, b.name(name));
      else b.end(match, ts);
      return true;
    }
  }
  return false;
}
