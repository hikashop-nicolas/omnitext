import { describe, expect, it } from "vitest";
import { gzipSync } from "fflate";
import { ProfileBuilder, callTree, callersOf, frameTotals, groupByLabel, stackWeights, threadTotals, timeHistogram, type Profile } from "./profile-model";
import { parsePerfFrame, readCollapsed, readPerfScript } from "./profile-read-text";
import { readChromeTraceProfiles, readCpuProfile, readGecko, readSpeedscope } from "./profile-read-json";
import { readPprof, readSimpleperf } from "./profile-read-proto";
import { pprofBytes, simpleperfBytes, spFile, spMeta, spSample, spThread } from "./profile.fixture";

/** Self and total by function name, for the default value type over every thread. */
function byName(p: Profile, value = p.defaultValue): Record<string, [number, number]> {
  const w = stackWeights(p, { threads: null, value });
  const { self, total } = frameTotals(p, w);
  const out: Record<string, [number, number]> = {};
  p.frames.forEach((f, i) => {
    if (total[i]! > 0) out[f.name] = [self[i]!, total[i]!];
  });
  return out;
}

/** The top-down tree as "a;b;c total" lines, depth first. */
function treeLines(p: Profile, inverted = false): string[] {
  const t = callTree(p, stackWeights(p, { threads: null, value: p.defaultValue }), inverted);
  const out: string[] = [];
  const walk = (n: number, path: string[]) => {
    for (const c of t.children[n]!) {
      const next = [...path, p.frames[t.frame[c]!]!.name];
      out.push(`${next.join(";")} ${t.total[c]}/${t.self[c]}`);
      walk(c, next);
    }
  };
  walk(0, []);
  return out;
}

describe("profile model", () => {
  it("interns frames and stacks, root first", () => {
    const b = new ProfileBuilder();
    const th = b.thread("1", { name: "main" });
    const a = b.frame("a");
    const bb = b.frame("b");
    expect(b.frame("a")).toBe(a);
    const s1 = b.stackOf([a, bb]);
    expect(b.stackOf([a, bb])).toBe(s1);
    expect(b.stackOf([a])).toBe(b.stack(-1, a));
    b.sample(s1, th, 3, 10);
    b.sample(-1, th, 5, 20); // no frames: dropped
    const p = b.finish();
    expect(p.sampleStack.length).toBe(1);
    expect([...p.stackParent]).toEqual([-1, 0]);
    expect(p.sampleTime).not.toBeNull();
    expect(p.sampleTime![0]).toBe(0); // times start at zero
  });

  it("computes self and total, counting recursion once", () => {
    const p = readCollapsed("a;b;a;b 2\na;b 3\nc 1\n");
    expect(byName(p)).toEqual({ a: [0, 5], b: [5, 5], c: [1, 1] });
    expect(treeLines(p)).toEqual(["a 5/0", "a;b 5/3", "a;b;a 2/0", "a;b;a;b 2/2", "c 1/1"]);
  });

  it("builds the inverted tree from each function's self time up to its callers", () => {
    const p = readCollapsed("main;work;leaf 4\nmain;other;leaf 2\nmain;work 1\n");
    expect(treeLines(p, true)).toEqual(["leaf 6/6", "leaf;work 4/0", "leaf;work;main 4/0", "leaf;other 2/0", "leaf;other;main 2/0", "work 1/1", "work;main 1/0"]);
  });

  it("merges threads, filters by thread and by time", () => {
    const b = new ProfileBuilder();
    const t1 = b.thread("1", { name: "one" });
    const t2 = b.thread("2", { name: "two" });
    const s = b.stackOf([b.frame("main"), b.frame("f")]);
    b.sample(s, t1, 1, 100);
    b.sample(s, t2, 2, 200);
    b.sample(s, t2, 4, 300);
    const p = b.finish();
    expect(callTree(p, stackWeights(p, { threads: null, value: 0 })).total[0]).toBe(7);
    expect(callTree(p, stackWeights(p, { threads: new Set([t2]), value: 0 })).total[0]).toBe(6);
    // Times are shifted to start at 0: 0, 100, 200.
    expect(callTree(p, stackWeights(p, { threads: null, value: 0, from: 50, to: 150 })).total[0]).toBe(2);
    expect([...threadTotals(p, 0)]).toEqual([1, 6]);
    expect([...timeHistogram(p, { threads: null, value: 0 }, 2, 200)]).toEqual([1, 6]);
  });

  it("lists a function's callers with the weight through each", () => {
    const p = readCollapsed("main;a;f 3\nmain;b;f 2\nf 1\n");
    const w = stackWeights(p, { threads: null, value: 0 });
    const f = p.frames.findIndex((x) => x.name === "f");
    const names = [...callersOf(p, w, f)].map(([c, v]) => [c < 0 ? "-" : p.frames[c]!.name, v]);
    expect(names).toEqual([["a", 3], ["b", 2], ["-", 1]]);
  });

  it("lays children out heaviest first along the root", () => {
    const p = readCollapsed("r;small 1\nr;big 5\n");
    const t = callTree(p, stackWeights(p, { threads: null, value: 0 }));
    const r = t.children[0]![0]!;
    const [big, small] = [...t.children[r]!];
    expect(p.frames[t.frame[big!]!]!.name).toBe("big");
    expect([t.x[big!], t.x[small!]]).toEqual([0, 5]);
    expect(t.maxDepth).toBe(2);
  });

  it("groups samples by a label", () => {
    const p = readPprof(
      pprofBytes({
        types: [["samples", "count"]],
        functions: ["main", "f"],
        samples: [
          { locs: [2, 1], values: [3], labels: [["span", "x"]] },
          { locs: [1], values: [1] },
        ],
      }),
    );
    const g = groupByLabel(p, p.labels!.keys.indexOf("span"), "none");
    expect(g.threads.map((t) => t.name)).toEqual(["x", "none"]);
    expect([...threadTotals(g, 0)]).toEqual([3, 1]);
  });
});

describe("collapsed stacks", () => {
  it("reads counts, comments, decimals and FlameGraph annotations", () => {
    const p = readCollapsed("# comment\n// other\nmain;read_[k] 2\nmain;compute 1.5\r\ninvalid line\n\njava;Lfoo/Bar;.run_[j] 4\n");
    expect(byName(p)).toMatchObject({ main: [0, 3.5], read: [2, 2], compute: [1.5, 1.5] });
    expect(p.frames.find((f) => f.name === "read")!.category).toBe("Kernel");
    expect(p.frames.find((f) => f.name === "Lfoo/Bar")).toBeDefined();
    expect(p.notes).toEqual(["skipped:1"]);
  });
});

describe("perf script", () => {
  const PERF = `# ========
# captured on: today
# ========
#
app  100/101 [002] 5000.000100:    250000 cpu-clock:u:
\t    7f00 leaf+0x10 (/usr/lib/libfoo.so)
\t    7f10 caller (/usr/bin/app)
\t    ffff do_syscall_64 ([kernel.kallsyms])

app  100/102 [001] 5000.000200:    250000 cpu-clock:u:
\t    7f20 other (/usr/bin/app)
\t    7f10 caller (/usr/bin/app)

app  100/101 [002] 5000.000300:     70000 page-faults:u:
\t    7f00 leaf+0x10 (/usr/lib/libfoo.so)

`;

  it("reads samples, threads, event types, periods and times", () => {
    const p = readPerfScript(PERF);
    expect(p.valueTypes.map((v) => `${v.type}/${v.label ?? ""}`)).toEqual(["cpu-clock:u/", "page-faults:u/", "cpu-clock:u/period", "page-faults:u/period"]);
    expect(p.defaultValue).toBe(0);
    expect(byName(p, 0)).toEqual({ do_syscall_64: [0, 1], caller: [0, 2], leaf: [1, 1], other: [1, 1] });
    expect(byName(p, 1)).toEqual({ leaf: [1, 1] });
    expect(byName(p, 2).caller).toEqual([0, 500000]);
    expect(p.threads.map((t) => [t.name, t.tid, t.pid, t.process])).toEqual([
      ["app", 101, 100, "app"],
      ["app", 102, 100, "app"],
    ]);
    expect([...p.sampleTime!]).toEqual([0, 100000, 200000].map((v) => expect.closeTo(v, 0) as unknown as number));
    expect(p.frames.find((f) => f.name === "do_syscall_64")!.category).toBe("Kernel");
    expect(p.frames.find((f) => f.name === "leaf")!.module).toBe("libfoo.so");
  });

  it("reads samples without callchains and old headers without a time", () => {
    const one = readPerfScript("a 1 [000] 1.000: 1 cycles:  ffff81 func_a (/bin/a)\na 1 [000] 1.001: 1 cycles:  ffff82 func_b (/bin/a)\na 1 [000] 1.002: 1 cycles:  ffff81 func_a (/bin/a)\n");
    expect(byName(one)).toEqual({ func_a: [2, 2], func_b: [1, 1] });
    const old = readPerfScript("java  3244 cpu-clock: \n\t    7f1e SpinPause (/lib/libjvm.so)\n\t    7f1f start_thread (/lib/libpthread.so)\n\n");
    expect(byName(old)).toEqual({ SpinPause: [1, 1], start_thread: [0, 1] });
    expect(old.sampleTime).toBeNull();
  });

  it("tidies JIT-compiled Java names", () => {
    const p = readPerfScript("java 1 [000] 1.000: 1 cycles: \n\t    7f00 Lorg/a/B;.run(I)V (/tmp/perf-1.map)\n\n");
    expect(p.frames[0]).toMatchObject({ name: "org.a.B.run", module: "perf-1.map", category: "Java" });
  });

  it("splits a frame line into symbol and module, nested parentheses too", () => {
    expect(parsePerfFrame("\t 7acf10291c art::Method_invoke(_JNIEnv*, _jobject*) (.__uniq.16) (/apex/libart.so)")).toEqual({
      sym: "art::Method_invoke(_JNIEnv*, _jobject*) (.__uniq.16)",
      dso: "/apex/libart.so",
    });
    expect(parsePerfFrame("  7f00 [unknown] (/memfd:jit-cache (deleted))")).toEqual({ sym: "[unknown]", dso: "/memfd:jit-cache (deleted)" });
    expect(parsePerfFrame("  not a frame")).toBeNull();
  });
});

describe("Gecko profiles", () => {
  it("reads the processed format with markers and categories", () => {
    const profile = {
      meta: { interval: 1, startTime: 1000, categories: [{ name: "Other" }, { name: "JavaScript" }], preprocessedProfileVersion: 50 },
      libs: [{ name: "libxul.so", path: "/usr/lib/libxul.so" }],
      threads: [
        {
          name: "GeckoMain",
          tid: 7,
          pid: "3",
          processName: "Web Content",
          stringArray: ["main", "run", "Click"],
          funcTable: { name: [0, 1], resource: [0, -1], isJS: [false, true], fileName: [null, null], length: 2 },
          resourceTable: { lib: [0], name: [0], length: 1 },
          frameTable: { func: [0, 1], category: [0, 1], line: [null, 12], length: 2 },
          stackTable: { prefix: [null, 0], frame: [0, 1], length: 2 },
          samples: { stack: [1, 1, 0, null], time: [0, 1, 2, 3], weight: null, weightType: "samples", length: 4 },
          markers: { name: [2], startTime: [1.5], endTime: [null], phase: [0], category: [1], data: [{ type: "DOMEvent", target: "btn" }], length: 1 },
        },
      ],
    };
    const p = readGecko(JSON.stringify(profile));
    expect(byName(p)).toEqual({ main: [1, 3], run: [2, 2] });
    expect(p.frames.map((f) => [f.name, f.module, f.category])).toEqual([
      ["main", "libxul.so", "Native"],
      ["run", "", "JavaScript"],
    ]);
    expect(p.threads[0]).toMatchObject({ name: "GeckoMain", tid: 7, pid: "3", process: "Web Content" });
    expect(p.markers).toEqual([{ name: "Click", start: 1.5e6, dur: 0, category: "JavaScript", thread: 0, detail: "target: btn" }]);
    expect(p.startedAt).toBe(1000);
  });

  it("reads the raw format: schemas, string tables, location strings and child processes", () => {
    const thread = (name: string, frames: string[]) => ({
      name,
      tid: 1,
      stringTable: frames,
      stackTable: { schema: { prefix: 0, frame: 1 }, data: [[null, 0], [0, 1]] },
      frameTable: { schema: { location: 0, category: 1 }, data: [[0], [1]] },
      samples: { schema: { stack: 0, time: 1 }, data: [[1, 10], [1, 11], [0, 12]] },
      markers: { schema: { name: 0, time: 1, data: 2 }, data: [[0, 10.5, { category: "Paint" }]] },
    });
    const sub = { meta: { startTime: 1010, interval: 1 }, threads: [thread("Content", ["(root)", "work (in libxul.so)"])], libs: "[]" };
    const main = { meta: { startTime: 1000, interval: 1, version: 5, stackwalk: 1, product: "Firefox" }, libs: "[]", threads: [JSON.stringify(thread("GeckoMain", ["(root)", "foo (https://a.test/app.js:12:4)"]))], processes: [sub] };
    const p = readGecko(JSON.stringify(main));
    expect(byName(p)).toEqual({ "(root)": [2, 6], foo: [2, 2], work: [2, 2] });
    const foo = p.frames.find((f) => f.name === "foo")!;
    expect([foo.module, foo.file, foo.line, foo.category]).toEqual(["app.js", "https://a.test/app.js", 12, "JavaScript"]);
    expect(p.frames.find((f) => f.name === "work")!.module).toBe("libxul.so");
    // The child process started 10 ms later: its samples are shifted by that much.
    const t = [...p.sampleTime!];
    expect(t[3]! - t[0]!).toBeCloseTo(10e6, -1);
    expect(p.markers.map((m) => m.category)).toEqual(["Paint", "Paint"]);
  });
});

describe("V8 CPU profiles", () => {
  const CPU = {
    nodes: [
      { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: -1 }, children: [2, 4] },
      { id: 2, callFrame: { functionName: "main", url: "file:///app.js", lineNumber: 0 }, children: [3] },
      { id: 3, callFrame: { functionName: "", url: "file:///app.js", lineNumber: 9 } },
      { id: 4, callFrame: { functionName: "(garbage collector)", url: "" } },
    ],
    startTime: 1000,
    endTime: 1100,
    samples: [3, 3, 2, 4],
    timeDeltas: [10, 20, 30, 10],
  };

  it("weighs samples by the time to the next one, and counts them", () => {
    const p = readCpuProfile(JSON.stringify(CPU));
    expect(p.valueTypes.map((v) => v.label)).toEqual(["time", "samples"]);
    // Times: 1010, 1030, 1060, 1070; the last runs to the end time, 1100.
    expect(byName(p, 0)).toEqual({ main: [10e3, 60e3], "(anonymous)": [50e3, 50e3], "(garbage collector)": [30e3, 30e3] });
    expect(byName(p, 1)).toEqual({ main: [1, 3], "(anonymous)": [2, 2], "(garbage collector)": [1, 1] });
    const anon = p.frames.find((f) => f.name === "(anonymous)")!;
    expect([anon.module, anon.line, anon.category]).toEqual(["app.js", 10, "JavaScript"]);
    expect(p.frames.find((f) => f.name === "(garbage collector)")!.category).toBe("GC");
  });

  it("falls back to hit counts, and reads the old nested format", () => {
    const hits = readCpuProfile(JSON.stringify({ nodes: [{ id: 1, callFrame: { functionName: "(root)" }, children: [2] }, { id: 2, callFrame: { functionName: "f" }, hitCount: 5 }] }));
    expect(hits.defaultValue).toBe(1);
    expect(byName(hits, 1)).toEqual({ f: [5, 5] });
    const old = readCpuProfile(
      JSON.stringify({ head: { functionName: "(root)", id: 1, children: [{ functionName: "a", id: 2, url: "x.js", children: [] }] }, startTime: 1, endTime: 2, samples: [2, 2], timestamps: [1000000, 1000500] }),
    );
    expect(byName(old, 1)).toEqual({ a: [2, 2] });
  });

  it("reads the CPU profile chunks of a Chrome trace, per thread", () => {
    const trace = {
      traceEvents: [
        { ph: "M", name: "thread_name", pid: 1, tid: 2, args: { name: "CrRendererMain" } },
        { ph: "M", name: "process_name", pid: 1, args: { name: "Renderer" } },
        { ph: "P", name: "Profile", id: "0x1", pid: 1, tid: 2, ts: 5, args: { data: { startTime: 100 } } },
        { ph: "P", name: "ProfileChunk", id: "0x1", pid: 1, tid: 9, ts: 6, args: { data: { cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: "(root)" } }, { id: 2, parent: 1, callFrame: { functionName: "run", url: "a.js" } }], samples: [2, 2] }, timeDeltas: [5, 5] } } },
        { ph: "P", name: "ProfileChunk", id: "0x1", pid: 1, tid: 9, ts: 7, args: { data: { cpuProfile: { nodes: [{ id: 3, parent: 2, callFrame: { functionName: "inner", url: "a.js" } }], samples: [3] }, timeDeltas: [5] } } },
        { ph: "X", name: "Other", pid: 1, tid: 2, ts: 1, dur: 1 },
      ],
    };
    const p = readChromeTraceProfiles(JSON.stringify(trace));
    expect(p.threads).toEqual([{ name: "CrRendererMain", tid: 2, pid: 1, process: "Renderer" }]);
    expect(byName(p, 1)).toEqual({ run: [2, 3], inner: [1, 1] });
    expect(readChromeTraceProfiles(JSON.stringify({ traceEvents: [{ ph: "X", name: "x", ts: 0, pid: 1, tid: 1 }] })).sampleStack.length).toBe(0);
  });
});

describe("speedscope", () => {
  it("reads evented and sampled profiles, one thread each", () => {
    const file = {
      $schema: "https://www.speedscope.app/file-format-schema.json",
      shared: { frames: [{ name: "a" }, { name: "b", file: "/src/b.py", line: 3 }] },
      profiles: [
        { type: "evented", name: "ev", unit: "milliseconds", startValue: 0, endValue: 10, events: [{ type: "O", frame: 0, at: 0 }, { type: "O", frame: 1, at: 2 }, { type: "C", frame: 1, at: 5 }, { type: "C", frame: 0, at: 10 }] },
        { type: "sampled", name: "sa", unit: "milliseconds", startValue: 0, endValue: 4, samples: [[0, 1], [0]], weights: [3, 1] },
      ],
    };
    const p = readSpeedscope(JSON.stringify(file));
    expect(p.threads.map((t) => t.name)).toEqual(["ev", "sa"]);
    expect(p.valueTypes).toEqual([{ type: "time", unit: "nanoseconds", label: "time" }]);
    expect(byName(p)).toEqual({ a: [8e6, 14e6], b: [6e6, 6e6] });
    const b = p.frames.find((f) => f.name === "b")!;
    expect([b.module, b.line, b.category]).toEqual(["b.py", 3, "Python"]);
    const ev = stackWeights(p, { threads: new Set([0]), value: 0 });
    expect(callTree(p, ev).total[0]).toBe(10e6);
  });
});

describe("pprof", () => {
  const spec = {
    types: [
      ["samples", "count"],
      ["cpu", "nanoseconds"],
    ] as [string, string][],
    functions: ["main", "work", "inlinedHelper"],
    samples: [
      { locs: [2, 1], values: [2, 20], labels: [["thread_name", "worker"] as [string, string]] },
      { locs: [1], values: [1, 10] },
    ],
    inlined: [2, 3] as [number, number],
  };

  it("reads sample types, locations with inlined lines, functions, mappings and labels", () => {
    for (const bytes of [pprofBytes(spec), gzipSync(pprofBytes(spec))]) {
      const p = readPprof(bytes);
      expect(p.valueTypes.map((v) => `${v.type}/${v.unit}`)).toEqual(["samples/count", "cpu/nanoseconds"]);
      expect(p.defaultValue).toBe(1); // pprof shows the last type
      // Location 2 holds work with inlinedHelper inlined into it: main;work;inlinedHelper.
      expect(treeLines(p)).toEqual(["main 30/10", "main;work 20/0", "main;work;inlinedHelper 20/20"]);
      expect(p.frames.find((f) => f.name === "work")).toMatchObject({ module: "app", file: "main.go", line: 12 });
      expect(p.threads.map((t) => t.name).sort()).toEqual(["", "worker"]);
      expect(p.labels!.keys).toEqual(["thread_name"]);
      expect(p.startedAt).toBe(1700);
    }
  });

  it("honours the default sample type", () => {
    expect(readPprof(pprofBytes({ ...spec, defaultType: "samples" })).defaultValue).toBe(0);
  });
});

describe("simpleperf", () => {
  it("reads samples, files, threads and event types, resolving names recorded after the samples", () => {
    const bytes = simpleperfBytes([
      spMeta(["cpu-clock", "sched:sched_switch"]),
      spSample(1_000, 11, 250, [
        [1, 0],
        [2, 0],
      ]),
      spSample(2_000, 12, 500, [
        [1, 1],
        [2, 0],
      ]),
      spSample(3_000, 11, 1, [[9, -1]], 1),
      spFile(1, "/system/lib64/libc.so", ["memcpy", "malloc"]),
      spFile(2, "/system/framework/boot.oat", ["java.lang.Thread.run"]),
      spThread(11, 11, "com.example"),
      spThread(12, 11, "RenderThread"),
    ]);
    const p = readSimpleperf(bytes);
    expect(p.valueTypes.map((v) => `${v.type}/${v.label ?? ""}`)).toEqual(["cpu-clock/", "sched:sched_switch/", "cpu-clock/events", "sched:sched_switch/events"]);
    expect(byName(p, 0)).toEqual({ memcpy: [1, 1], malloc: [1, 1], "java.lang.Thread.run": [0, 2] });
    expect(byName(p, 2)["java.lang.Thread.run"]).toEqual([0, 750]);
    expect(byName(p, 1)).toEqual({ "0x100": [1, 1] });
    expect(p.threads.map((t) => [t.name, t.pid, t.process])).toEqual([
      ["com.example", 11, "com.example"],
      ["RenderThread", 11, "com.example"],
    ]);
    expect(p.frames.find((f) => f.name === "java.lang.Thread.run")!.category).toBe("Java");
    expect([...p.sampleTime!]).toEqual([0, 1000, 2000]);
    expect(readSimpleperf(gzipSync(bytes)).sampleStack.length).toBe(3);
  });
});
