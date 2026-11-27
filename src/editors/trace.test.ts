import { describe, expect, it } from "vitest";
import { ModelBuilder, type CounterTrack, type CpuTrack } from "./trace-model";
import { clampRange, counterColumns, firstEndingAfter, lowerBound, niceStep, sliceBlocks, tickUnit, zoomRange } from "./trace-range";
import { readChromeTrace } from "./trace-chrome";
import { readSystrace, systraceBlocks } from "./trace-systrace";
import { looksLikeChromeTrace, looksLikeSystrace } from "../formats/trace-detect";
import { chromeTraceFormat } from "../formats/chrometrace";
import { systraceFormat } from "../formats/systrace";
import { allSlices } from "./perfetto-trace.fixture";

describe("trace model", () => {
  it("nests slices into levels, longest first at equal starts", () => {
    const b = new ModelBuilder();
    b.thread(10, 1, "main");
    b.slice("t:10", 100, 10, b.name("inner"));
    b.slice("t:10", 0, 1000, b.name("outer"));
    b.slice("t:10", 100, 500, b.name("middle"));
    b.slice("t:10", 2000, 0, b.name("instant"));
    const m = b.finish();
    expect(allSlices(m)).toEqual([
      ["main 10", "outer", 0, 1000, 0],
      ["main 10", "instant", 2000, 0, 0],
      ["main 10", "middle", 100, 500, 1],
      ["main 10", "inner", 100, 10, 2],
    ]);
    expect(m.groups.map((g) => g.label)).toEqual(["1"]); // process 1 has no name of its own
    expect(m.sliceCount).toBe(4);
  });

  it("matches begin and end in time order, whatever order they came in", () => {
    const b = new ModelBuilder();
    b.end("t:5", 300);
    b.begin("t:5", "t:5", 100, b.name("a"));
    b.begin("t:5", "t:5", 150, b.name("b"));
    b.end("t:5", 200);
    b.begin("t:5", "t:5", 400, b.name("open"));
    b.time(1000);
    const m = b.finish();
    expect(allSlices(m)).toEqual([
      ["5", "a", 100, 200, 0],
      ["5", "open", 400, 600, 0], // still open: runs to the end
      ["5", "b", 150, 50, 1],
    ]);
  });

  it("puts overlapping slices that do not nest on a free level, whole", () => {
    const b = new ModelBuilder();
    b.slice("t:1", 0, 100, b.name("p"));
    b.slice("t:1", 10, 20, b.name("child"));
    b.slice("t:1", 50, 100, b.name("overlap"));
    b.slice("t:1", 60, 10, b.name("inside overlap"));
    expect(allSlices(b.finish())).toEqual([
      ["1", "p", 0, 100, 0],
      ["1", "child", 10, 20, 1],
      ["1", "overlap", 50, 100, 1],
      ["1", "inside overlap", 60, 10, 2],
    ]);
  });

  it("builds CPU rows with idle gaps and sorts out-of-order switches", () => {
    const b = new ModelBuilder();
    b.switchTo(0, 300, 0);
    b.switchTo(0, 100, 7);
    b.switchTo(0, 200, 8);
    b.time(500);
    const cpu = b.finish().groups[0]!.tracks[0] as CpuTrack;
    expect([...cpu.ts]).toEqual([100, 200]);
    expect([...cpu.dur]).toEqual([100, 100]);
    expect([...cpu.tid]).toEqual([7, 8]);
  });

  it("follows aliases and descriptions for tracks", () => {
    const b = new ModelBuilder();
    b.thread(42, 4, "worker");
    b.process(4, "app");
    b.slice("u:x", 0, 10, b.name("s"));
    b.alias("u:x", "t:42");
    b.describe("async", { label: "Loads", pid: 4 });
    b.slice("async", 0, 5, b.name("load"));
    b.counter("mem", 0, 5, { label: "Memory", pid: 4 });
    b.counter("mem", 10, 9);
    const m = b.finish();
    const g = m.groups.find((x) => x.pid === 4)!;
    expect(g.label).toBe("app 4");
    expect(g.tracks.map((t) => t.label)).toEqual(["Memory", "worker 42", "Loads"]);
    const c = g.tracks[0] as CounterTrack;
    expect([c.min, c.max]).toEqual([5, 9]);
  });
});

describe("visible range", () => {
  const ts = Float64Array.from([0, 10, 20, 30, 1000]);
  const dur = Float64Array.from([5, 5, 5, 900, 10]);

  it("binary searches starts and ends", () => {
    expect(lowerBound(ts, 15)).toBe(2);
    expect(firstEndingAfter(ts, dur, 24)).toBe(2);
    expect(firstEndingAfter(ts, dur, 26)).toBe(3);
  });

  it("draws wide slices one by one", () => {
    const out: [number, number, number, boolean][] = [];
    sliceBlocks(ts, dur, 0, 1100, 1, (x0, x1, i, merged) => out.push([x0, x1, i, merged]));
    expect(out).toEqual([
      [0, 5, 0, false],
      [10, 15, 1, false],
      [20, 25, 2, false],
      [30, 930, 3, false],
      [1000, 1010, 4, false],
    ]);
  });

  it("merges sub-pixel slices per column but keeps a long one that starts there", () => {
    const out: [number, number, number, boolean][] = [];
    // 0.01 px per ns: the first three slices share column 0, slice 3 starts at 0.3 px and is 9 px wide.
    sliceBlocks(ts, dur, 0, 11, 0.01, (x0, x1, i, merged) => out.push([Math.round(x0 * 100) / 100, Math.round(x1 * 100) / 100, i, merged]));
    expect(out).toEqual([
      [0, 1, 0, true],
      [0.3, 9.3, 3, false],
      [10, 11, 4, false],
    ]);
  });

  it("stays bounded by pixels on a million slices", () => {
    const n = 1_000_000;
    const big = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      big[i] = i * 10;
      d[i] = 5;
    }
    let calls = 0;
    const blocks = sliceBlocks(big, d, 0, 800, 800 / (n * 10), () => calls++);
    expect(blocks).toBeLessThanOrEqual(801);
    expect(calls).toBe(blocks);
    // Zoomed in on the middle: only the visible ones.
    const few = sliceBlocks(big, d, 5_000_000, 800, 1, () => {});
    expect(few).toBe(81); // both ends of the window included
  });

  it("gives counter extremes per column", () => {
    const cts = Float64Array.from([0, 1, 2, 3, 10]);
    const val = Float64Array.from([5, 1, 9, 4, 7]);
    const cols: [number, number, number][] = [];
    counterColumns(cts, val, 0, 3, 0.25, (x, lo, hi) => cols.push([x, lo, hi]));
    expect(cols).toEqual([
      [0, 1, 9],
      [1, 4, 4],
      [2, 4, 7],
    ]);
  });

  it("picks ruler steps and units", () => {
    expect(niceStep(37)).toBe(50);
    expect(niceStep(1200)).toBe(2000);
    expect(niceStep(8_000_000)).toBe(10_000_000);
    expect(tickUnit(500)).toEqual(["nanosecond", 1]);
    expect(tickUnit(2000)).toEqual(["microsecond", 1000]);
    expect(tickUnit(5e6)).toEqual(["millisecond", 1e6]);
    expect(tickUnit(2e9)).toEqual(["second", 1e9]);
  });

  it("zooms around an anchor and stays inside the trace", () => {
    expect(zoomRange(0, 1000, 500, 0.5, 0, 1000, 10)).toEqual([250, 750]);
    expect(zoomRange(0, 1000, 0, 0.5, 0, 1000, 10)).toEqual([0, 500]);
    expect(zoomRange(200, 400, 300, 100, 0, 1000, 10)).toEqual([0, 1000]);
    expect(clampRange(-50, 50, 0, 1000)).toEqual([0, 100]);
    expect(clampRange(950, 1050, 0, 1000)).toEqual([900, 1000]);
  });
});

describe("Chrome JSON traces", () => {
  const json = JSON.stringify({
    traceEvents: [
      { ph: "M", name: "process_name", pid: 1, args: { name: "Browser" } },
      { ph: "M", name: "thread_name", pid: 1, tid: 2, args: { name: "CrBrowserMain" } },
      { ph: "X", name: "Task", pid: 1, tid: 2, ts: 10, dur: 100, args: { src: "a.cc" } },
      { ph: "B", name: "Inner", pid: 1, tid: 2, ts: 20 },
      { ph: "E", pid: 1, tid: 2, ts: 30 },
      { ph: "i", name: "Mark", pid: 1, tid: 2, ts: 50, s: "t" },
      { ph: "C", name: "Heap", pid: 1, ts: 10, args: { used: 5, total: 8 } },
      { ph: "C", name: "Heap", pid: 1, ts: 60, args: { used: 6, total: 8 } },
      { ph: "b", name: "Load", cat: "net", id: "0x1", pid: 1, tid: 2, ts: 15 },
      { ph: "e", name: "Load", cat: "net", id: "0x1", pid: 1, tid: 2, ts: 95 },
    ],
  });

  it("reads slices, names, counters and async events into the model", async () => {
    const m = await readChromeTrace(json);
    expect(m.start).toBe(10_000);
    expect(m.end).toBe(110_000);
    expect(allSlices(m)).toEqual([
      ["CrBrowserMain 2", "Task", 10_000, 100_000, 0],
      ["CrBrowserMain 2", "Inner", 20_000, 10_000, 1],
      ["CrBrowserMain 2", "Mark", 50_000, 0, 1],
      ["Load", "Load", 15_000, 80_000, 0],
    ]);
    const g = m.groups.find((x) => x.pid === 1)!;
    expect(g.label).toBe("Browser 1");
    const counters = g.tracks.filter((t) => t.kind === "counter").map((t) => t.label).sort();
    expect(counters).toEqual(["Heap total", "Heap used"]);
    const task = g.tracks.find((t) => t.label === "CrBrowserMain 2")!;
    expect(task.kind === "slices" && JSON.parse(m.args[task.levels[0]!.arg[0]!]!)).toEqual({ src: "a.cc" });
  });

  it("reads a bare array of events", async () => {
    const m = await readChromeTrace(JSON.stringify([{ ph: "X", name: "A", pid: "p", tid: "t", ts: 1, dur: 1 }]));
    expect(allSlices(m).map((x) => x[1])).toEqual(["A"]);
  });

  it("is told apart from other JSON", () => {
    expect(looksLikeChromeTrace(json.slice(0, 200))).toBe(true);
    expect(looksLikeChromeTrace('[{"name":"A","ph":"X","ts":1,"pid":2,"tid":3}]')).toBe(true);
    expect(looksLikeChromeTrace('{"name": "package", "version": "1.0.0"}')).toBe(false);
    expect(looksLikeChromeTrace('[{"id": 1, "ts": 2, "pid": 3}]')).toBe(false); // no phase
    expect(chromeTraceFormat.detect({ sample: json, filename: "trace.json" })).toBeGreaterThan(0.78);
    expect(chromeTraceFormat.detect({ sample: '{"a":1}', filename: "a.json" })).toBe(0);
  });
});

describe("systrace text", () => {
  const text = [
    "# tracer: nop",
    "#",
    "#           TASK-PID    TGID   CPU#  ||||    TIMESTAMP  FUNCTION",
    "#              | |        |      |   ||||       |         |",
    "          <idle>-0     (-----) [001] d..3  100.000000: sched_switch: prev_comm=swapper/1 prev_pid=0 prev_prio=120 prev_state=R ==> next_comm=RenderThread next_pid=301 next_prio=110",
    "    RenderThread-301   (  300) [001] ...1  100.000100: tracing_mark_write: B|300|DrawFrame",
    "    RenderThread-301   (  300) [001] ...1  100.000400: tracing_mark_write: E|300",
    "    RenderThread-301   (  300) [001] ...1  100.000500: tracing_mark_write: C|300|queued|3",
    "    RenderThread-301   (  300) [001] d..3  100.001000: sched_switch: prev_comm=RenderThread prev_pid=301 prev_prio=110 prev_state=S ==> next_comm=swapper/1 next_pid=0 next_prio=120",
    "          <idle>-0     [002] d..2  100.002000: cpu_frequency: state=1200000 cpu_id=2",
    "   surfaceflinger-500 [000] 100.003000: print: tracing_mark_write: B|500|onMessage",
  ].join("\n");

  it("reads sched_switch, atrace markers and cpu_frequency", async () => {
    const r = await readSystrace(text);
    const m = r.model;
    expect(r.ftraceTotal).toBe(7);
    expect(r.ftrace.get("sched_switch")).toBe(2);
    expect([...r.cpus].sort()).toEqual([0, 1, 2]);
    const cpu1 = m.groups[0]!.tracks.find((t) => t.kind === "cpu" && t.cpu === 1) as CpuTrack;
    expect([...cpu1.tid]).toEqual([301]);
    expect([...cpu1.dur]).toEqual([1_000_000]);
    expect(allSlices(m)).toEqual([
      ["RenderThread 301", "DrawFrame", 100_000_100_000, 300_000, 0],
      ["surfaceflinger 500", "onMessage", 100_003_000_000, 0, 0],
    ]);
    expect(m.threads.get(301)?.pid).toBe(300);
    const counters = m.groups.flatMap((g) => g.tracks).filter((t) => t.kind === "counter").map((t) => t.label);
    expect(counters.sort()).toEqual(["CPU 2 freq (kHz)", "queued"]);
  });

  it("finds the trace inside a systrace HTML page", async () => {
    const html = `<!DOCTYPE html><html><head><title>Android System Trace</title></head><body>
<script class="trace-data" type="application/text">${text}</script>
<script class="trace-data" type="application/text">{"traceEvents":[{"ph":"X","name":"Json","pid":9,"tid":9,"ts":100000001,"dur":1}]}</script>
</body></html>`;
    expect(systraceBlocks(html).ftrace).toHaveLength(1);
    expect(looksLikeSystrace(html.slice(0, 200))).toBe(true);
    const r = await readSystrace(html);
    expect(allSlices(r.model).map((x) => x[1]).sort()).toEqual(["DrawFrame", "Json", "onMessage"]);
  });

  it("is recognised by content", () => {
    expect(looksLikeSystrace(text)).toBe(true);
    expect(looksLikeSystrace("TRACE:\n# tracer: nop\n")).toBe(true);
    expect(looksLikeSystrace("# Title\n\nSome markdown about # tracer: nop")).toBe(false);
    expect(systraceFormat.detect({ sample: text, filename: "trace.txt" })).toBeGreaterThan(0.95);
  });
});
