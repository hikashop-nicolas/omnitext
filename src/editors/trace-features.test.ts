import { describe, expect, it } from "vitest";
import { decompress } from "fzstd";
import { ModelBuilder, ThreadState, kernelState, letterState, type CounterTrack, type SliceTrack, type TraceModel } from "./trace-model";
import { parseTrace, parseTraceSync } from "./perfetto-parse";
import { readChromeTrace } from "./trace-chrome";
import { readSystrace } from "./trace-systrace";
import { allSlices, bytes, m, packed, s, trace, u, varint } from "./perfetto-trace.fixture";

// Thread states, flows, async packing, zstd packets, legacy Chrome timestamps and the ftrace
// clock, each on small synthetic inputs.

const tracks = (model: TraceModel) => model.groups.flatMap((g) => g.tracks);
const thread = (model: TraceModel, tid: number) => tracks(model).find((t) => t.kind === "slices" && t.tid === tid) as SliceTrack;
const states = (t: SliceTrack) => [...t.states!.state].map((v, i) => [v, t.states!.ts[i], t.states!.dur[i], t.states!.cpu[i]]);
/** Flows as [from name, to name]. */
const flowNames = (model: TraceModel) =>
  model.flows.map((f) => [f.from, f.to].map((r) => model.names[r.track.levels[r.level]!.name[r.index]!]));

/** A zstd frame holding `data` in one raw block (no compression: the decoder takes it as is). */
function zstdRaw(data: number[]): Uint8Array {
  if (data.length > 255) throw new Error("small frames only");
  const n = data.length;
  const block = (n << 3) | 1; // last block, raw
  return Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, n, block & 255, (block >> 8) & 255, (block >> 16) & 255, ...data]);
}

/** A fixed64 field. */
const f64 = (field: number, hi: number, lo: number): number[] => {
  const out = varint((field << 3) | 1);
  for (let i = 0; i < 4; i++) out.push((lo >>> (8 * i)) & 255);
  for (let i = 0; i < 4; i++) out.push((hi >>> (8 * i)) & 255);
  return out;
};

describe("thread states", () => {
  it("maps kernel and text prev_state to Perfetto's states", () => {
    expect(kernelState(0)).toBe(ThreadState.Runnable);
    expect(kernelState(0x100)).toBe(ThreadState.Runnable); // R+, preempted
    expect(kernelState(1)).toBe(ThreadState.Sleeping);
    expect(kernelState(2)).toBe(ThreadState.Uninterruptible);
    expect(kernelState(0x80)).toBe(ThreadState.Idle);
    expect(kernelState(16)).toBe(ThreadState.Dead);
    expect(letterState("R+")).toBe(ThreadState.Runnable);
    expect(letterState("D|K")).toBe(ThreadState.Uninterruptible);
    expect(letterState("x")).toBe(ThreadState.Dead);
  });

  it("runs, sleeps, wakes and runs again", () => {
    const b = new ModelBuilder();
    b.thread(7, 1, "worker");
    b.switchTo(0, 100, 7);
    b.switchTo(0, 200, 0, ThreadState.Sleeping);
    b.waking(250, 7);
    b.switchTo(1, 300, 7);
    b.switchTo(1, 400, 9, ThreadState.Runnable);
    b.time(500);
    const t = thread(b.finish(), 7);
    expect(t.levels).toHaveLength(0); // a row for its states alone
    expect(states(t)).toEqual([
      [ThreadState.Running, 100, 100, 0],
      [ThreadState.Sleeping, 200, 50, -1],
      [ThreadState.Runnable, 250, 50, -1],
      [ThreadState.Running, 300, 100, 1],
      [ThreadState.Runnable, 400, 100, -1], // preempted, until the end of the trace
    ]);
  });

  it("ignores a wakeup of a thread already running, and stops at death", () => {
    const b = new ModelBuilder();
    b.switchTo(0, 0, 5);
    b.waking(10, 5);
    b.switchTo(0, 50, 0, ThreadState.Dead);
    b.time(100);
    expect(states(thread(b.finish(), 5))).toEqual([[ThreadState.Running, 0, 50, 0]]);
  });

  it("comes from sched_switch prev_state and sched_waking in Perfetto, full and compact", () => {
    const sw = (ts: number, prev: number, state: number, next: number) =>
      m(2, u(1, ts), u(2, prev), m(4, s(1, "a"), u(2, prev), u(4, state), s(5, "b"), u(6, next)));
    const t = trace(
      [m(1, u(1, 0), sw(1000, 0, 0, 42), sw(2000, 42, 2, 0), m(2, u(1, 2500), m(20, s(1, "b"), u(2, 42))))],
      // Compact: 42 runs on CPU 1 at 3000, sleeps at 3500 (state 1); woken at 3600.
      [m(1, u(1, 1), m(4, s(5, "b"), packed(1, [3000, 500]), packed(2, [0, 1]), packed(3, [42, 0]), packed(6, [0, 0]), packed(7, [3600]), packed(8, [42])))],
    );
    const st = states(thread(parseTraceSync(t).model, 42));
    expect(st).toEqual([
      [ThreadState.Running, 1000, 1000, 0],
      [ThreadState.Uninterruptible, 2000, 500, -1],
      [ThreadState.Runnable, 2500, 500, -1],
      [ThreadState.Running, 3000, 500, 1],
      [ThreadState.Sleeping, 3500, 100, -1],
      [ThreadState.Runnable, 3600, 0, -1],
    ].filter((x) => x[2] !== 0));
  });

  it("comes from systrace prev_state and sched_wakeup lines", async () => {
    const text = [
      "# tracer: nop",
      "  <idle>-0 [000] d..3 1.000000: sched_switch: prev_comm=swapper prev_pid=0 prev_prio=120 prev_state=R ==> next_comm=app next_pid=9 next_prio=120",
      "     app-9 [000] d..3 1.000010: sched_switch: prev_comm=app prev_pid=9 prev_prio=120 prev_state=D ==> next_comm=swapper next_pid=0 next_prio=120",
      "  <idle>-0 [000] d.h3 1.000020: sched_wakeup: comm=app pid=9 prio=120 success=1 target_cpu=000",
      "  <idle>-0 [000] d..3 1.000030: sched_switch: prev_comm=swapper prev_pid=0 prev_prio=120 prev_state=R ==> next_comm=app next_pid=9 next_prio=120",
    ].join("\n");
    const st = states(thread((await readSystrace(text)).model, 9));
    // The last switch is the end of the trace: running from there has no length.
    expect(st.map((x) => x[0])).toEqual([ThreadState.Running, ThreadState.Uninterruptible, ThreadState.Runnable]);
  });
});

describe("flows", () => {
  it("chains the slices that carry a flow id, in time order, until one ends it", () => {
    const b = new ModelBuilder();
    const a = b.slice("t:1", 0, 10, b.name("send"));
    const c = b.slice("t:2", 30, 10, b.name("reply"));
    const r = b.begin("t:2", "t:2", 20, b.name("receive"));
    b.end("t:2", 25);
    b.flowId("x", c, 30, true);
    b.flowId("x", a, 0);
    b.flowId("x", r, 20);
    const late = b.slice("t:1", 50, 1, b.name("late"));
    b.flowId("x", late, 50); // after the end: a new flow, not linked back
    expect(flowNames(b.finish())).toEqual([["send", "receive"], ["receive", "reply"]]);
  });

  it("binds JSON s/t/f events to the slices around them, an f to the next one", async () => {
    const model = await readChromeTrace(JSON.stringify([
      { ph: "X", name: "Post", pid: 1, tid: 1, ts: 0, dur: 10 },
      { ph: "s", name: "ipc", cat: "c", id: 5, pid: 1, tid: 1, ts: 5 },
      { ph: "X", name: "Run", pid: 1, tid: 2, ts: 20, dur: 10 },
      { ph: "t", name: "ipc", cat: "c", id: 5, pid: 1, tid: 2, ts: 25 },
      { ph: "f", name: "ipc", cat: "c", id: 5, pid: 1, tid: 3, ts: 35 },
      { ph: "X", name: "Done", pid: 1, tid: 3, ts: 40, dur: 1 },
      // Flow v2 on complete events
      { ph: "X", name: "Out", pid: 1, tid: 4, ts: 50, dur: 1, bind_id: "0x9", flow_out: true },
      { ph: "X", name: "In", pid: 1, tid: 5, ts: 60, dur: 1, bind_id: "0x9", flow_in: true },
    ]));
    expect(flowNames(model).sort()).toEqual([["Out", "In"], ["Post", "Run"], ["Run", "Done"]]);
  });

  it("reads Perfetto flow_ids, terminating_flow_ids and v1 bind ids", () => {
    const ev = (ts: number, tid: number, name: string, ...more: number[][]) => [u(10, tid), u(8, ts), m(11, u(9, 3), s(23, name), ...more)];
    const t = trace(
      [u(10, 1), m(44, u(1, 1), u(2, 1))],
      [u(10, 2), m(44, u(1, 1), u(2, 2))],
      ev(100, 1, "a", f64(47, 0, 77)),
      ev(200, 2, "b", f64(48, 0, 77)),
      ev(300, 1, "c", m(6, u(8, 5), u(13, 2))), // FLOW_OUT
      ev(400, 2, "d", m(6, u(8, 5), u(13, 1))), // FLOW_IN
    );
    expect(flowNames(parseTraceSync(t).model)).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("async rows", () => {
  it("lays out each async track on its own and packs them, instead of stacking them", () => {
    const b = new ModelBuilder();
    // Three instances of one named async track, each a parent with a child, two overlapping.
    for (const [k, t0] of [[1, 0], [2, 50], [3, 200]] as const) {
      b.describe(`a:${k}`, { pid: 1 });
      b.slice(`a:${k}`, t0, 100, b.name("Pipeline"));
      b.slice(`a:${k}`, t0 + 10, 20, b.name("Stage"));
    }
    b.process(1, "app");
    const row = tracks(b.finish()).find((t) => t.label === "Pipeline") as SliceTrack;
    // 1 on levels 0-1, 2 (overlapping 1) on levels 2-3, 3 back on 0-1.
    expect(row.levels.map((l) => [...l.ts])).toEqual([[0, 200], [10, 210], [50], [60]]);
  });

  it("matches a JSON async end by id even without its name, and global ids across processes", async () => {
    const model = await readChromeTrace(JSON.stringify([
      { ph: "b", name: "Load", cat: "net", id: "1", pid: 1, tid: 1, ts: 0 },
      { ph: "e", cat: "net", id: "1", pid: 1, tid: 1, ts: 10 },
      { ph: "S", name: "Input", cat: "in", id: "7", pid: 1, tid: 1, ts: 20 },
      { ph: "F", name: "Input", cat: "in", id: "7", pid: 2, tid: 2, ts: 30 },
      { ph: "R", name: "Mark", pid: 1, tid: 1, ts: 40 },
    ]));
    expect(allSlices(model).sort()).toEqual([
      ["1", "Mark", 40_000, 0, 0],
      ["Input", "Input", 20_000, 10_000, 0],
      ["Load", "Load", 0, 10_000, 0],
    ]);
  });
});

describe("Perfetto readers", () => {
  const sliceTrace = (...packets: number[][][]) =>
    trace([u(10, 1), m(44, u(1, 1), u(2, 2), s(5, "main"))], ...packets);

  it("reads zstd_compressed_packets once the decoder is loaded", async () => {
    const inner = m(1, u(10, 1), u(8, 500), m(11, u(9, 3), s(23, "Zipped")));
    const t = sliceTrace([bytes(133, zstdRaw(inner))]);
    let loads = 0;
    const r = await parseTrace(t, { zstd: async () => (loads++, decompress) });
    expect(loads).toBe(1);
    expect(allSlices(r.model)).toEqual([["main 2", "Zipped", 500, 0, 0]]);
    expect(r.summary.zstdPackets).toBe(0);
    expect(r.summary.packetTypes.get("zstd_compressed_packets")).toBe(1);
    // Without a decoder the packets are counted as skipped.
    const off = await parseTrace(t, { zstd: () => Promise.reject(new Error("offline")) });
    expect(off.summary.zstdPackets).toBe(1);
    expect(off.model.sliceCount).toBe(0);
    expect(parseTraceSync(t, decompress).model.sliceCount).toBe(1);
  });

  it("reads legacy TrackEvent timestamps and thread times from the thread descriptor", () => {
    const t = trace(
      [u(10, 1), u(13, 1), m(44, u(1, 1), u(2, 2), s(5, "main"), u(6, 1000), u(7, 50))],
      [u(10, 1), m(11, u(1, 10), u(2, 3), s(23, "Work"), m(6, u(2, 66)))], // B at 1010 us, thread 53 us
      [u(10, 1), m(11, u(1, 20), u(2, 7), m(6, u(2, 69)))], // E at 1030 us, thread 60 us
      [u(10, 1), m(11, u(16, 5000), s(23, "Abs"), m(6, u(2, 88), u(3, 2), u(4, 1)))], // X, absolute
      [u(10, 1), m(11, u(1, 5), s(23, "After"), m(6, u(2, 73)))], // deltas go on from 1030
    );
    const { model } = parseTraceSync(t);
    expect(allSlices(model)).toEqual([
      ["main 2", "Work", 1_010_000, 20_000, 0],
      ["main 2", "After", 1_035_000, 0, 0],
      ["main 2", "Abs", 5_000_000, 2_000, 0],
    ]);
    const main = thread(model, 2);
    expect(model.args[main.levels[0]!.arg[0]!]).toBe("thread_duration_us: 7");
    expect(model.args[main.levels[0]!.arg[2]!]).toBe("thread_duration_us: 1");
  });

  it("moves ftrace events on the global clock to boot time with the bundle's pair", () => {
    const ev = (ts: number) => m(2, u(1, ts), u(2, 9), m(3, s(2, ts === 100 ? "B|9|Draw" : "E|9")));
    const t = trace(
      [m(1, u(1, 0), u(5, 2), u(6, 50), u(7, 10_050), ev(100), ev(300))],
      [m(1, u(1, 0), u(5, 1), ev(100))], // FTRACE_CLOCK_UNKNOWN: left out
    );
    expect(allSlices(parseTraceSync(t).model)).toEqual([["9", "Draw", 10_100, 200, 0]]);
  });

  it("reads power rails as counters named by their descriptors", () => {
    const t = trace(
      [m(40, m(1, u(1, 0), s(2, "S4M_VDD_CPUCL0"), s(3, "cpu")))],
      [u(8, 1000), m(40, m(2, u(1, 0), u(2, 1), u(3, 500)))],
      [u(8, 2000), m(40, m(2, u(1, 0), u(2, 2), u(3, 900)))],
    );
    const c = tracks(parseTraceSync(t).model).find((x) => x.kind === "counter") as CounterTrack;
    expect(c.label).toBe("power.rails.s4m_vdd_cpucl0");
    expect([...c.ts]).toEqual([1000, 2000]);
    expect([...c.val]).toEqual([500, 900]);
  });
});

describe("systrace quirks", () => {
  it("reads early systrace pages whose lines end in \\n\\ and skips the clock sync marker", async () => {
    const text = [
      "# tracer: nop\\n\\",
      "   app-9 [000] 50.000100: tracing_mark_write: B|9|Draw\\n\\",
      "   app-9 [000] 50.000300: tracing_mark_write: E\\n\\",
      "   dummy-0000  [000] 0.0: 0: trace_event_clock_sync: parent_ts=0.0\\n\";",
    ].join("\n");
    const r = await readSystrace(text);
    expect(allSlices(r.model)).toEqual([["app 9", "Draw", 50_000_100_000, 200_000, 0]]);
    expect(r.model.start).toBe(50_000_100_000);
  });
});
