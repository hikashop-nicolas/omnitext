import { describe, expect, it } from "vitest";
import { looksLikePerfetto } from "../core/sniff";
import { parseTrace, parseTraceSync } from "./perfetto-parse";
import { SYNC, bytes, m, s, sampleTrace, trace, u } from "./perfetto-trace.fixture";

describe("Perfetto trace summary", () => {
  const base = 5_000_000_000;
  const sum = parseTraceSync(sampleTrace());

  it("counts packets by data type", () => {
    expect(sum.stoppedAt).toBeNull();
    expect(sum.packets).toBe(14); // 13 outer + 1 inside the compressed packet
    expect(sum.packetTypes.get("ftrace_events")).toBe(1);
    expect(sum.packetTypes.get("android_log")).toBe(2);
    expect(sum.packetTypes.get("track_event")).toBe(3);
    expect(sum.packetTypes.get("synchronization_marker")).toBe(1);
    expect(sum.packetTypes.get("compressed_packets")).toBe(1);
  });

  it("finds the time range and the wall-clock start", () => {
    expect(sum.firstTs).toBe(base);
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
    expect(sum.atrace.get("Choreographer#doFrame")).toBe(1);
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

  it("resolves interned track event names and skips slice ends", () => {
    expect(sum.trackEvents.get("DrawFrame")).toBe(1);
    expect(sum.trackEvents.get("Tap")).toBe(1);
    expect(sum.trackEvents.size).toBe(2);
  });

  it("reads the system info", () => {
    expect(sum.system).toMatchObject({ kernel: "Linux 6.1.0 aarch64", sdk: 35, cpus: 8 });
  });

  it("keeps what it read from a cut-off trace", () => {
    const full = sampleTrace();
    const cut = full.subarray(0, full.length - 5);
    const part = parseTraceSync(cut);
    expect(part.stoppedAt).not.toBeNull();
    expect(part.packets).toBe(12); // the compressed packet at the end is the one cut
    expect(part.logTotal).toBe(2);
  });

  it("gives the same result in time slices", async () => {
    let progress = 0;
    const big = new Uint8Array(sampleTrace().length * 200);
    const one = sampleTrace();
    for (let i = 0; i < 200; i++) big.set(one, i * one.length);
    const sliced = await parseTrace(big, { slice: 0, onProgress: () => progress++ });
    expect(progress).toBeGreaterThan(0);
    expect(sliced.packets).toBe(14 * 200);
    expect(sliced.logTotal).toBe(600);
    expect(sliced.stoppedAt).toBeNull();
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

