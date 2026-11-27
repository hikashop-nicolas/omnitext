import { describe, expect, it } from "vitest";
import { looksLikePerfetto } from "../core/sniff";
import { parseTrace, parseTraceSync } from "./perfetto-parse";
import type { CounterTrack, CpuTrack, SliceTrack } from "./trace-model";
import { SYNC, allSlices, bytes, m, s, sampleTrace, trace, u } from "./perfetto-trace.fixture";

describe("Perfetto trace summary", () => {
  const base = 5_000_000_000;
  const { summary: sum, model } = parseTraceSync(sampleTrace());

  it("counts packets by data type", () => {
    expect(sum.stoppedAt).toBeNull();
    expect(sum.packets).toBe(20); // 19 outer + 1 inside the compressed packet
    expect(sum.packetTypes.get("ftrace_events")).toBe(1);
    expect(sum.packetTypes.get("android_log")).toBe(2);
    expect(sum.packetTypes.get("track_event")).toBe(6);
    expect(sum.packetTypes.get("synchronization_marker")).toBe(1);
    expect(sum.packetTypes.get("compressed_packets")).toBe(1);
  });

  it("finds the time range from what is drawn, and the wall-clock start", () => {
    expect(sum.firstTs).toBe(base + 500); // the first CPU slice, not the clock snapshot at base
    expect(sum.lastTs).toBe(base + 4_000_000_000);
    expect(sum.wallStartMs).toBeCloseTo(1_700_000_000_000, -1);
  });

  it("reads processes and threads from every source", () => {
    const app = sum.processes.get(300)!;
    expect(app).toMatchObject({ pid: 300, ppid: 1, name: "com.example.app", cmdline: "com.example.app --flag", rssKb: 120_000 });
    expect(sum.processes.get(1)?.name).toBe("init");
    expect(sum.processes.get(400)?.name).toBe("com.example.sdk");
    expect(sum.threads.get(301)).toEqual({ tid: 301, pid: 300, name: "RenderThread" });
    expect(sum.threads.get(401)).toEqual({ tid: 401, pid: 400, name: "worker" });
  });

  it("counts ftrace events by name, compact sched included", () => {
    expect(sum.ftrace.get("sched_switch")).toBe(4); // 1 full + 3 compact
    expect(sum.ftrace.get("sched_waking")).toBe(1);
    expect(sum.ftrace.get("print")).toBe(2);
    expect(sum.ftrace.get("cpu_frequency")).toBe(1);
    expect(sum.ftrace.get("event #9999")).toBe(1);
    expect(sum.ftraceTotal).toBe(9);
    expect([...sum.cpus]).toEqual([2]);
  });

  it("keeps the logcat lines, compressed ones too", () => {
    expect(sum.logTotal).toBe(3);
    expect(sum.logs.map((l) => [l.tag, l.prio, l.msg])).toEqual([
      ["ActivityManager", 4, "Start proc 300"],
      ["AndroidRuntime", 6, "FATAL EXCEPTION: main"],
      ["Zipped", 4, "from a compressed packet"],
    ]);
    expect(sum.logs[0]).toMatchObject({ pid: 300, tid: 301, ts: base + 1_000_000_000 });
  });

  it("reads the system info", () => {
    expect(sum.system).toMatchObject({ kernel: "Linux 6.1.0 aarch64", sdk: 35, cpus: 8 });
  });

  it("builds CPU rows from full and compact sched_switch, with idle as gaps", () => {
    const cpu = model.groups[0]!;
    expect(cpu.key).toBe("cpu");
    const row = cpu.tracks.find((t) => t.kind === "cpu") as CpuTrack;
    expect(row.cpu).toBe(2);
    // switch to 2 at +500, to 300 at +1000, idle at +1500, to 301 at +2000 until the trace end
    expect([...row.ts]).toEqual([base + 500, base + 1000, base + 2000]);
    expect([...row.tid]).toEqual([2, 300, 301]);
    expect([...row.dur]).toEqual([500, 500, 4_000_000_000 - 2000]);
    expect(model.threads.get(2)?.name).toBe("b");
    const freq = cpu.tracks.find((t) => t.kind === "counter") as CounterTrack;
    expect([...freq.val]).toEqual([1_800_000]);
  });

  it("turns atrace markers and track events into nested thread slices", () => {
    const slices = allSlices(model);
    expect(slices).toContainEqual(["app 300", "Choreographer#doFrame", base + 600, 100, 0]);
    // Interned name, resolved through the track descriptor of sequence 2 (pid 400 / no thread): a process track.
    expect(slices.find((x) => x[1] === "DrawFrame")).toBeDefined();
    expect(slices.find((x) => x[1] === "Tap")?.[3]).toBe(0);
    // Sequence 3: incremental clock 64 starting at 1000 = boot base + 3.5 s.
    expect(slices).toContainEqual(["binder 302", "Outer", base + 3_500_000_500, 1000, 0]);
  });

  it("keeps debug annotations as slice arguments", () => {
    const t = model.groups.flatMap((g) => g.tracks).find((x) => x.label === "binder 302") as SliceTrack;
    expect(model.args[t.levels[0]!.arg[0]!]).toBe("count: 7");
  });

  it("puts counter tracks under their process", () => {
    const g = model.groups.find((x) => x.pid === 300)!;
    expect(g.label).toBe("com.example.app 300");
    const mem = g.tracks.find((t) => t.kind === "counter") as CounterTrack;
    expect(mem.label).toBe("Memory");
    expect([...mem.val]).toEqual([42]);
    expect(mem.ts[0]).toBe(base + 3_500_001_510);
  });

  it("keeps what it read from a cut-off trace", () => {
    const full = sampleTrace();
    const cut = full.subarray(0, full.length - 5);
    const part = parseTraceSync(cut).summary;
    expect(part.stoppedAt).not.toBeNull();
    expect(part.packets).toBe(19); // the last packet is the one cut
    expect(part.logTotal).toBe(3);
  });

  it("gives the same result in time slices", async () => {
    let progress = 0;
    const one = sampleTrace();
    const big = new Uint8Array(one.length * 200);
    for (let i = 0; i < 200; i++) big.set(one, i * one.length);
    const sliced = await parseTrace(big, { slice: 0, onProgress: () => progress++ });
    expect(progress).toBeGreaterThan(0);
    expect(sliced.summary.packets).toBe(20 * 200);
    expect(sliced.summary.logTotal).toBe(600);
    expect(sliced.summary.stoppedAt).toBeNull();
  });
});

describe("Perfetto sniffing", () => {
  it("recognises the synchronization marker in the first packets", () => {
    expect(looksLikePerfetto(sampleTrace())).toBe(true);
    const later = trace([u(8, 1), m(6, m(1, u(1, 6), u(2, 1)))], [u(10, 1), bytes(36, SYNC)]);
    expect(looksLikePerfetto(later)).toBe(true);
  });

  it("refuses protobuf without the marker, and random bytes", () => {
    expect(looksLikePerfetto(trace([u(8, 1), s(2, "x".repeat(40))]))).toBe(false);
    const noise = new Uint8Array(4096).map((_, i) => (i * 7919 + 13) & 255);
    expect(looksLikePerfetto(noise)).toBe(false);
    const fake = Uint8Array.from([0x0b, ...bytes(36, SYNC)]);
    expect(looksLikePerfetto(fake)).toBe(false);
  });
});

describe("Chrome-style track events (as Chrome writes them)", () => {
  const boot = 9_000_000_000;
  const mono = 8_000_000_000; // MONOTONIC is 1 s behind BOOTTIME in the global snapshot
  // Global snapshot on sequence 1, then a sequence whose clock 65 (incremental, in us) is
  // defined against MONOTONIC, not the trace clock: Chrome's layout.
  const head = [
    [u(10, 1), m(6, m(1, u(1, 6), u(2, boot)), m(1, u(1, 3), u(2, mono)), u(2, 6))],
    [u(10, 2), u(13, 1), u(79, 50), m(59, u(58, 65), m(11, u(11, 7))), m(6, m(1, u(1, 3), u(2, mono + 1_000_000)), m(1, u(1, 65), u(2, (mono + 1_000_000) / 1000), u(4, 1000), u(3, 1)))],
    [u(10, 2), u(79, 50), m(60, u(1, 7), m(4, u(1, 50), u(2, 51), s(5, "CrBrowserMain")))],
    [u(10, 2), u(79, 50), m(60, u(1, 1), m(3, u(1, 50), s(6, "Browser")))],
  ];

  it("follows a sequence clock defined against MONOTONIC", () => {
    const t = trace(...head, [u(10, 2), u(79, 50), u(8, 10), m(11, u(9, 3), s(23, "Tick"))]);
    const { model } = parseTraceSync(t);
    // 1 ms after the snapshot in MONOTONIC, +10 us, moved onto BOOTTIME.
    expect(allSlices(model)).toEqual([["CrBrowserMain 51", "Tick", boot + 1_000_000 + 10_000, 0, 0]]);
  });

  it("puts events with no track_uuid on the sequence's default track", () => {
    const t = trace(...head, [u(10, 2), u(79, 50), u(8, 10), m(11, u(9, 1), s(23, "Task"))], [u(10, 2), u(79, 50), u(8, 5), m(11, u(9, 2))]);
    const [slice] = allSlices(parseTraceSync(t).model);
    expect(slice!.slice(0, 2)).toEqual(["CrBrowserMain 51", "Task"]);
    expect(slice![3]).toBe(5000);
  });

  it("reads untyped legacy events by their phase", () => {
    const legacy = (phase: string, ...more: number[][]) => m(6, u(2, phase.charCodeAt(0)), ...more);
    const t = trace(
      ...head,
      [u(10, 2), u(79, 50), u(8, 100), m(11, s(23, "Complete"), legacy("X", u(3, 5)))],
      [u(10, 2), u(79, 50), u(8, 10), m(11, s(23, "Outer"), legacy("B"))],
      [u(10, 2), u(79, 50), u(8, 100), m(11, legacy("E"))],
      // Async begin/end matched by id, with an explicit track_uuid of 0 ("no track").
      [u(10, 2), u(79, 50), u(8, 1), m(11, u(11, 0), s(23, "Load"), legacy("b", u(10, 99)))],
      [u(10, 2), u(79, 50), u(8, 1), m(11, u(11, 0), s(23, "Load"), legacy("b", u(10, 98)))],
      [u(10, 2), u(79, 50), u(8, 300), m(11, u(11, 0), s(23, "Load"), legacy("e", u(10, 99)))],
      [u(10, 2), u(79, 50), u(8, 100), m(11, u(11, 0), s(23, "Load"), legacy("e", u(10, 98)))],
    );
    const { model } = parseTraceSync(t);
    const t0 = boot + 1_000_000;
    // Times accumulate on the incremental clock: 100, 110, 210, 211, 212, 512, 612 us.
    expect(allSlices(model)).toEqual([
      ["CrBrowserMain 51", "Complete", t0 + 100_000, 5_000, 0],
      ["CrBrowserMain 51", "Outer", t0 + 110_000, 100_000, 0],
      ["Load", "Load", t0 + 211_000, 301_000, 0],
      ["Load", "Load", t0 + 212_000, 400_000, 1],
    ]);
    const g = model.groups.find((x) => x.pid === 50)!;
    expect(g.label).toBe("Browser 50");
    // Threads before the process's other tracks.
    expect(g.tracks.map((x) => x.label)).toEqual(["CrBrowserMain 51", "Load"]);
  });

  it("reads an absolute sequence clock (64) on the same base as the incremental one (65)", () => {
    // Sequence 2 also defines clock 64: absolute microseconds on MONOTONIC, as Chrome writes for
    // events stamped after the fact. Both must land on the same BOOTTIME instant.
    const at = (mono + 1_000_000) / 1000 + 10; // 10 us after the snapshot, as clock 64 reads it
    const t = trace(
      head[0]!,
      [u(10, 2), u(13, 1), u(79, 50), m(59, u(58, 65), m(11, u(11, 7))), m(6, m(1, u(1, 3), u(2, mono + 1_000_000)), m(1, u(1, 64), u(2, (mono + 1_000_000) / 1000), u(4, 1000)), m(1, u(1, 65), u(2, (mono + 1_000_000) / 1000), u(4, 1000), u(3, 1)))],
      ...head.slice(2),
      [u(10, 2), u(79, 50), u(8, 10), m(11, u(9, 3), s(23, "Incremental"))],
      [u(10, 2), u(79, 50), u(58, 64), u(8, at), m(11, u(9, 3), s(23, "Absolute"))],
    );
    const times = allSlices(parseTraceSync(t).model).map((x) => [x[1], x[2]]);
    expect(times).toEqual([["Incremental", boot + 1_010_000], ["Absolute", boot + 1_010_000]]);
  });

  it("takes the trace bounds from drawn events, not from metadata packets", () => {
    const t = trace(
      ...head,
      [u(8, boot - 60_000_000_000), m(33, u(1, 1))], // a trace_config stamped a minute earlier
      [u(10, 2), u(79, 50), u(8, 10), m(11, u(9, 3), s(23, "Tick"))],
    );
    const { summary, model } = parseTraceSync(t);
    expect(model.start).toBe(boot + 1_010_000);
    expect(summary.firstTs).toBe(model.start);
    expect(summary.lastTs).toBe(model.end);
  });

  it("names unnamed tracks after their slices and merges same-named ones", () => {
    const t = trace(
      ...head,
      [u(10, 2), m(60, u(1, 20), u(5, 1))],
      [u(10, 2), m(60, u(1, 21), u(5, 1))],
      [u(10, 2), u(79, 50), u(8, 10), m(11, u(9, 3), u(11, 20), s(23, "Navigation"))],
      [u(10, 2), u(79, 50), u(8, 10), m(11, u(9, 3), u(11, 21), s(23, "Navigation"))],
    );
    const g = parseTraceSync(t).model.groups.find((x) => x.pid === 50)!;
    const nav = g.tracks.filter((x) => x.label === "Navigation") as SliceTrack[];
    expect(nav).toHaveLength(1);
    expect(nav[0]!.count).toBe(2);
  });
});
