import { describe, expect, it } from "vitest";
import { strToU8, zipSync, zlibSync, gzipSync } from "fflate";
import { ModelBuilder, type SliceTrack, type TraceModel } from "./trace-model";
import { emptySummary } from "./perfetto-parse";
import { readNinjaInto } from "./trace-ninja";
import { readStraceInto } from "./trace-strace";
import { readLogcatInto } from "./trace-logcat";
import { readFuchsiaInto } from "./trace-fuchsia";
import { readSystrace } from "./trace-systrace";
import { loadArchive, loadBytes, loadText } from "./trace-load";
import { allSlices } from "./perfetto-trace.fixture";
import { ctraceStart, isFxt, logcatFormat, looksLikeNinjaLog, looksLikeStrace, looksLikeSystrace } from "../formats/trace-detect";
import { bytesKind, entryKind, textKind } from "../formats/trace-kind";
import { isTraceArchive } from "../formats/trace-archive-detect";
import { writeTar } from "../core/tar";
import { sniffHead } from "../core/sniff";
import { ctraceFormat, fuchsiaTraceFormat, logcatTextFormat, ninjaLogFormat, straceFormat } from "../formats/trace-formats";

const threadRow = (m: TraceModel, tid: number): SliceTrack =>
  m.groups.flatMap((g) => g.tracks).find((t) => t.kind === "slices" && t.tid === tid) as SliceTrack;

const PLAIN = "Shopping list\nmilk\neggs\nbread (two loaves)\nbutter\ncall mum: about Sunday\n";
const C_CODE = "int main(void) {\n  int fd = open(\"x\", O_RDONLY);\n  read(fd, buf, 3);\n  close(fd);\n  return 0;\n}\n";
const APP_LOG = "2026-11-27 09:21:19,123 INFO server: started\n2026-11-27 09:21:20,001 WARN db: slow query\n2026-11-27 09:21:21,500 ERROR api: timeout\n";

describe("trace format detection", () => {
  it("knows a ninja log by its header only", () => {
    expect(looksLikeNinjaLog("# ninja log v5\n1\t2\t0\ta.o\tabc\n")).toBe(true);
    expect(looksLikeNinjaLog("# ninja log v7\r\n")).toBe(true);
    expect(looksLikeNinjaLog("# ninja build file\nrule cc\n")).toBe(false);
    expect(ninjaLogFormat.detect({ sample: PLAIN })).toBe(0);
  });

  it("claims strace output only when most lines are system calls", () => {
    const tt = '1234  10:20:30.123456 openat(AT_FDCWD, "/etc/passwd", O_RDONLY) = 3 <0.000015>\n1234  10:20:30.123500 read(3, "root", 4) = 4 <0.000005>\n1234  10:20:30.123600 close(3) = 0 <0.000002>\n';
    expect(looksLikeStrace(tt)).toBe(true);
    expect(looksLikeStrace('[pid  75] 1787734451.08 wait4(-1,  <unfinished ...>\n[pid  74] 1787734451.09 <... wait4 resumed>) = 75\n--- SIGCHLD {si_signo=SIGCHLD} ---\n+++ exited with 0 +++\n')).toBe(true);
    expect(looksLikeStrace('execve("./a", ["./a"], 0x7ffd /* 4 vars */) = 0\nbrk(NULL) = 0x55\naccess("/etc/ld.so.preload", R_OK) = -1 ENOENT (No such file or directory)\n')).toBe(true);
    expect(looksLikeStrace(PLAIN)).toBe(false);
    expect(looksLikeStrace(C_CODE)).toBe(false);
    expect(looksLikeStrace(APP_LOG)).toBe(false);
    expect(straceFormat.detect({ sample: C_CODE })).toBe(0);
  });

  it("claims logcat only when nearly every line is in one logcat format", () => {
    const tt = "--------- beginning of main\n11-27 09:21:19.123  1234  5678 I ActivityManager: Start proc 1234:com.example/u0a12\n11-27 09:21:19.200  1234  5678 D Tag     : hello\n11-27 09:21:19.300  1234  5679 E Other: boom\r\r\n";
    expect(logcatFormat(tt)).toBe("threadtime");
    expect(logcatFormat("07-29 14:08:04.677 D/WifiController( 1921): battery\n07-29 14:08:04.700 I/Vold(  103): up\n07-29 14:08:05.000 W/Sys( 312): x\n")).toBe("time");
    expect(logcatFormat("I/Vold    (  103): Vold 2.1\nD/Vold    (  103): Volume\nI/SystemServer(  312): Entered\n")).toBe("brief");
    expect(logcatFormat(PLAIN)).toBeNull();
    expect(logcatFormat(APP_LOG)).toBeNull();
    // One logcat line among other text is not enough.
    expect(logcatFormat(`${PLAIN}11-27 09:21:19.123  1234  5678 I Tag: x\n`)).toBeNull();
    expect(logcatTextFormat.detect({ sample: APP_LOG })).toBe(0);
    expect(logcatTextFormat.detect({ sample: tt })).toBeGreaterThan(0.95);
  });

  it("knows trace-cmd report output as ftrace text", () => {
    expect(looksLikeSystrace("version = 6\ncpus=2\n       trace-cmd-2746  [000]  1105.406629: sched_switch:          prev_comm=a\n")).toBe(true);
    expect(looksLikeSystrace("cpus=2\nsomething else\n")).toBe(false);
  });

  it("knows FXT and compressed systrace by their first bytes", () => {
    const fxt = new Uint8Array([0x10, 0, 4, 0x46, 0x78, 0x54, 0x16, 0, 0, 0, 0, 0]);
    expect(isFxt(fxt)).toBe(true);
    expect(sniffHead(fxt)).toBe("fuchsia");
    expect(fuchsiaTraceFormat.sniffBytes!(fxt)).toBe(true);
    const ctrace = ctraceBytes("# tracer: nop\n");
    expect(ctraceStart(ctrace)).toBeGreaterThan(0);
    expect(sniffHead(ctrace)).toBe("ctrace");
    expect(ctraceFormat.sniffBytes!(ctrace)).toBe(true);
    expect(ctraceStart(strToU8("TRACE:\n# tracer: nop\n"))).toBe(-1);
    expect(bytesKind(strToU8(PLAIN))).toBeNull();
  });

  it("sorts text into its kind, and leaves other text alone", () => {
    expect(textKind("# ninja log v6\n")).toBe("ninja");
    expect(textKind(PLAIN)).toBeNull();
    expect(textKind(APP_LOG)).toBeNull();
    expect(textKind('{"name":"x","items":[1,2]}')).toBeNull();
  });
});

function ctraceBytes(text: string): Uint8Array {
  const head = strToU8("capturing trace... done\nTRACE:\n");
  const z = zlibSync(strToU8(text));
  const out = new Uint8Array(head.length + z.length);
  out.set(head);
  out.set(z, head.length);
  return out;
}

describe("ninja log", () => {
  it("merges the outputs of one command and packs steps onto workers", () => {
    const log = "# ninja log v5\n0\t100\t0\ta.o\taa\n0\t100\t0\ta.h\taa\n10\t50\t0\tb.o\tbb\n50\t80\t0\tc.o\tcc\n120\t200\t0\tapp\tdd\nbad line\n";
    const b = new ModelBuilder();
    const stats = readNinjaInto(b, log);
    const m = b.finish();
    expect(allSlices(m)).toEqual([
      ["Worker 1", "a.o a.h", 0, 100e6, 0],
      ["Worker 1", "app", 120e6, 80e6, 0],
      ["Worker 2", "b.o", 10e6, 40e6, 0],
      ["Worker 2", "c.o", 50e6, 30e6, 0],
    ]);
    const fact = (k: string) => stats.facts.find((f) => f.key === k)?.value;
    expect(fact("ninjaSteps")).toBe(4);
    expect(fact("ninjaOutputs")).toBe(5);
    expect(fact("ninjaWorkers")).toBe(2);
    expect(fact("linesSkipped")).toBe(1);
    expect(stats.tables[0]!.rows[0]).toEqual(["a.o a.h", 100e6]);
  });
});

describe("strace", () => {
  it("reads -f -tt -T output, resumed calls, clones, signals and exits", () => {
    const text = [
      '100   10:00:00.000000 execve("/bin/sh", ["sh"], 0x7f /* 4 vars */) = 0 <0.001000>',
      "100   10:00:00.002000 clone(child_stack=NULL, flags=CLONE_VM|CLONE_THREAD|CLONE_SIGHAND) = 101 <0.000100>",
      "101   10:00:00.003000 futex(0x7f, FUTEX_WAIT, 2, NULL <unfinished ...>",
      "100   10:00:00.004000 clone(child_stack=NULL, flags=SIGCHLD) = 200 <0.000100>",
      "101   10:00:00.005000 <... futex resumed>) = 0 <0.002000>",
      '200   10:00:00.006000 openat(AT_FDCWD, "/nope", O_RDONLY) = -1 ENOENT (No such file or directory) <0.000010>',
      "100   10:00:00.007000 --- SIGCHLD {si_signo=SIGCHLD} ---",
      "200   10:00:00.008000 +++ exited with 0 +++",
      "strace: Process 300 attached",
    ].join("\n");
    const b = new ModelBuilder();
    const { stats } = readStraceInto(b, text);
    const m = b.finish();
    expect(m.threads.get(101)?.pid).toBe(100);
    expect(m.threads.get(200)?.pid).toBe(200);
    expect(m.processes.get(100)?.name).toBe("sh");
    const futex = threadRow(m, 101).levels[0]!;
    expect([futex.ts[0], futex.dur[0]]).toEqual([36000e9 + 3e6, 2e6]);
    const names = (tid: number) => [...threadRow(m, tid).levels[0]!.name].map((n) => m.names[n]);
    expect(names(100)).toEqual(["execve", "clone", "clone", "SIGCHLD"]);
    expect(names(200)).toEqual(["openat", "exited with 0"]);
    const fact = (k: string) => stats.facts.find((f) => f.key === k)?.value;
    expect(fact("straceCalls")).toBe(5);
    expect(fact("straceErrors")).toBe(1);
    expect(fact("linesSkipped")).toBe(1);
  });

  it("keeps -ttt times exact and splits a call resumed then cut again", () => {
    const text = "1000 1700000052.321000 epoll_wait(4, <unfinished ...>\n1000 1700000052.321500 <... epoll_wait resumed> {}, 64, 100 <unfinished ...>\n1000 1700000052.322000 <... epoll_wait resumed> {}, 64, 100) = 1\n";
    const b = new ModelBuilder();
    const r = readStraceInto(b, text);
    const lv = threadRow(b.finish(), 1000).levels[0]!;
    expect([...lv.ts]).toEqual([321000000, 321500000]);
    expect([...lv.dur]).toEqual([500000, 500000]);
    expect(r.wallStartMs).toBe(1700000052321);
  });

  it("puts lines without pid or time on one thread, in order", () => {
    const b = new ModelBuilder();
    const r = readStraceInto(b, 'execve("./a", ["./a"], 0x7f /* 1 var */) = 0\nbrk(NULL) = 0x55\nclose(3) = 0\n');
    const m = b.finish();
    expect(m.processes.get(1)?.name).toBe("a");
    expect(threadRow(m, 1).count).toBe(3);
    expect(r.stats.facts.some((f) => f.key === "straceNoTime")).toBe(true);
  });
});

describe("logcat", () => {
  it("fills the log table and puts lines on their thread's row", () => {
    const text = "--------- beginning of main\n11-27 09:21:19.123  1234  5678 I ActivityManager: Start proc 4321:com.example/u0a12 for activity\n11-27 09:21:19.200  4321  4321 W Tag     : careful\n11-27 09:21:20.000  4321  4322 E Other: boom\n";
    const b = new ModelBuilder();
    const s = emptySummary(text.length);
    const r = readLogcatInto(b, text, s, null, 2026);
    const m = b.finish();
    expect(s.logTotal).toBe(3);
    expect(s.logs.map((l) => [l.pid, l.tid, l.prio, l.tag, l.msg])).toEqual([
      [1234, 5678, 4, "ActivityManager", "Start proc 4321:com.example/u0a12 for activity"],
      [4321, 4321, 5, "Tag", "careful"],
      [4321, 4322, 6, "Other", "boom"],
    ]);
    expect(s.logs.map((l) => l.ts)).toEqual([0, 77e6, 877e6]);
    expect(m.processes.get(4321)?.name).toBe("com.example");
    expect(threadRow(m, 4322).count).toBe(1);
    expect(r.lines).toBe(3);
    expect(r.wallStartMs).toBe(new Date(2026, 10, 27, 9, 21, 19, 123).getTime());
  });

  it("reads -v time and -v brief", () => {
    const b = new ModelBuilder();
    const s = emptySummary(0);
    readLogcatInto(b, "07-29 14:08:04.677 D/WifiController( 1921): battery\n07-29 14:08:04.700 I/Vold(  103): up\n07-29 14:08:05.000 W/Sys( 312): x\n", s);
    expect(s.logs.map((l) => [l.pid, l.tid, l.tag, l.msg])).toEqual([[1921, 1921, "WifiController", "battery"], [103, 103, "Vold", "up"], [312, 312, "Sys", "x"]]);
    const s2 = emptySummary(0);
    const b2 = new ModelBuilder();
    readLogcatInto(b2, "I/Vold    (  103): Vold 2.1\nD/Vold    (  103): Volume\nI/SystemServer(  312): Entered\n", s2);
    expect(s2.logTotal).toBe(3);
    expect(s2.logs[0]!.tag).toBe("Vold");
    // No times: the lines are listed but not drawn.
    expect(b2.finish().sliceCount).toBe(0);
  });
});

/** A little FXT writer for the tests. */
class Fxt {
  words: bigint[] = [];
  rec(header: bigint, ...rest: bigint[]): void {
    const size = BigInt(1 + rest.length);
    this.words.push(header | (size << 4n), ...rest);
  }
  str(s: string): bigint[] {
    const b = strToU8(s);
    const out: bigint[] = [];
    for (let i = 0; i < b.length; i += 8) {
      let w = 0n;
      for (let k = 0; k < 8 && i + k < b.length; k++) w |= BigInt(b[i + k]!) << BigInt(8 * k);
      out.push(w);
    }
    return out;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.words.length * 8);
    const dv = new DataView(out.buffer);
    this.words.forEach((w, i) => dv.setBigUint64(i * 8, w, true));
    return out;
  }
}

describe("Fuchsia FXT", () => {
  it("reads strings, threads, durations, counters, async slices, flows, objects and scheduling", () => {
    const f = new Fxt();
    f.words.push(0x0016547846040010n);
    f.rec(1n, 1000000n); // 1 MHz ticks
    const string = (i: number, s: string) => f.rec(2n | (BigInt(i) << 16n) | (BigInt(strToU8(s).length) << 32n), ...f.str(s));
    string(1, "cat");
    string(2, "work");
    string(3, "inner");
    string(4, "process");
    f.rec(3n | (1n << 16n), 10n, 11n); // thread 1 = pid 10 tid 11
    const ev = (type: number, thread: bigint, name: number, nargs: number, ...rest: bigint[]) =>
      f.rec(4n | (BigInt(type) << 16n) | (BigInt(nargs) << 20n) | (thread << 24n) | (1n << 32n) | (BigInt(name) << 48n), ...rest);
    ev(4, 1n, 2, 0, 100n, 400n); // complete: 100..400 us
    ev(2, 1n, 3, 0, 150n); // begin inner
    ev(3, 1n, 3, 0, 250n); // end
    // Counter with an int32 argument named inline "v" = 7 (arg header: type 1, 1 word, inline name len 1).
    ev(1, 1n, 2, 1, 300n, 1n | (2n << 4n) | (0x8001n << 16n) | (7n << 32n), ...f.str("v"), 5n);
    // Async begin/end on an inline thread (pid 10, tid 12), correlation id 9.
    ev(5, 0n, 2, 0, 500n, 10n, 12n, 9n);
    ev(7, 0n, 2, 0, 700n, 10n, 12n, 9n);
    // A flow from tid 11's "work" to a slice on tid 12.
    ev(8, 1n, 2, 0, 200n, 77n);
    ev(4, 0n, 3, 0, 800n, 10n, 12n, 900n);
    ev(10, 0n, 3, 0, 850n, 10n, 12n, 77n);
    // Kernel objects: process 10 "app", thread 12 "worker" of process 10 (koid arg "process").
    f.rec(7n | (1n << 16n) | (0x8003n << 24n), 10n, ...f.str("app"));
    f.rec(7n | (2n << 16n) | (0x8006n << 24n) | (1n << 40n), 12n, ...f.str("worker"), 8n | (2n << 4n) | (4n << 16n), 10n);
    // Context switch (new format) on CPU 1: thread 11 runs at 50 us, then idle at 90 us.
    f.rec(8n | (1n << 20n) | (1n << 36n) | (1n << 60n), 50n, 0n, 11n);
    f.rec(8n | (1n << 20n) | (3n << 36n) | (1n << 60n) | (1n << 16n), 90n, 11n, 0n, 1n | (1n << 4n) | (0x800fn << 16n) | (0x80000000n << 32n), ...f.str("incoming_weight"));
    const b = new ModelBuilder();
    const s = emptySummary(0);
    const stats = readFuchsiaInto(b, f.bytes(), s);
    const m = b.finish();
    expect(m.processes.get(10)?.name).toBe("app");
    expect(m.threads.get(12)?.name).toBe("worker");
    expect(m.threads.get(11)?.pid).toBe(10);
    const t11 = threadRow(m, 11);
    expect(t11.levels.map((l) => [...l.ts])).toEqual([[100e3], [150e3]]);
    expect(t11.levels[0]!.dur[0]).toBe(300e3);
    const counter = m.groups.flatMap((g) => g.tracks).find((t) => t.kind === "counter");
    expect(counter?.label).toBe("work:v:5");
    const asyncRow = m.groups.flatMap((g) => g.tracks).find((t) => t.kind === "slices" && t.tid === undefined) as SliceTrack;
    expect([asyncRow.levels[0]!.ts[0], asyncRow.levels[0]!.dur[0]]).toEqual([500e3, 200e3]);
    expect(m.flows).toHaveLength(1);
    expect(m.schedCount).toBe(1);
    expect(stats.facts.find((x) => x.key === "fxtBad")).toBeUndefined();
  });

  it("survives a record cut short", () => {
    const f = new Fxt();
    f.words.push(0x0016547846040010n);
    f.rec(2n | (1n << 16n) | (40n << 32n), 0n); // claims 40 bytes, has 8
    const stats = readFuchsiaInto(new ModelBuilder(), f.bytes(), emptySummary(0));
    expect(stats.facts.find((x) => x.key === "fxtBad")?.value).toBe(1);
  });
});

describe("ftrace text", () => {
  it("reads numeric prev_state, function tracer and function_graph lines", async () => {
    const text = [
      "version = 6",
      "cpus=2",
      "           <idle>-0     [000]  1105.400000: sched_switch:          prev_comm=swapper prev_pid=0 prev_prio=120 prev_state=0x0 next_comm=trace-cmd next_pid=2746 next_prio=120",
      "       trace-cmd-2746  [000]  1105.406629: sched_switch:          prev_comm=trace-cmd prev_pid=2746 prev_prio=120 prev_state=0x1 next_comm=gs next_pid=2744 next_prio=130",
      "            bash-1234  [001] ....  1105.500000: do_sys_open <-sys_open",
      "  1105.600000 |   1)   ping-1556    |  .... |               |  ext4_bread() {",
      "  1105.600001 |   1)   ping-1556    |  .... |   0.913 us    |    _raw_read_lock();",
      "  1105.600010 |   1)   ping-1556    |  .... |   9.156 us    |  } /* ext4_bread */",
    ].join("\n");
    const r = await readSystrace(text);
    expect(r.model.schedCount).toBe(2);
    const st = threadRow(r.model, 2746).states!;
    expect(st.state[st.state.length - 1]).toBe(2); // Sleeping, from 0x1
    expect(allSlices(r.model).filter((x) => x[0] !== "gs 2744")).toEqual([
      ["bash 1234", "do_sys_open", 1105.5e9, 0, 0],
      ["ping 1556", "ext4_bread", 1105.6e9, 10000, 0],
      ["ping 1556", "_raw_read_lock", 1105.600001e9, 913, 1],
    ]);
  });
});

describe("loading and archives", () => {
  it("reads a compressed systrace", async () => {
    const r = await loadBytes(ctraceBytes("# tracer: nop\n  app-100 (  100) [001] ...1  1.000000: tracing_mark_write: B|100|work\n  app-100 (  100) [001] ...1  1.500000: tracing_mark_write: E|100\n"));
    expect(r.kind).toBe("ctrace");
    expect(allSlices(r.model)).toEqual([["app 100", "work", 1e9, 0.5e9, 0]]);
    expect(r.summary.ftraceTotal).toBe(2);
  });

  it("opens text by content", async () => {
    expect((await loadText("# ninja log v5\n0\t10\t0\ta.o\taa\n")).kind).toBe("ninja");
  });

  it("merges an archive's traces on one timeline and lists what it read", async () => {
    const files = {
      "a.systrace": strToU8("# tracer: nop\n  app-100 (  100) [001] ...1  1.000000: tracing_mark_write: B|100|zip_slice\n  app-100 (  100) [001] ...1  1.500000: tracing_mark_write: E|100\n"),
      "b.ninja_log.gz": gzipSync(strToU8("# ninja log v5\n0\t10\t0\ta.o\taa\n")),
      "notes.md": strToU8("# Notes\n"),
    };
    const r = await loadArchive(Object.entries(files).map(([name, data]) => ({ name, read: async () => data })), 100);
    expect(r.kind).toBe("archive");
    expect(r.files).toEqual([
      { name: "a.systrace", kind: "systrace" },
      { name: "b.ninja_log.gz", kind: "ninja" },
      { name: "notes.md", kind: null },
    ]);
    expect(allSlices(r.model).map((x) => x[1])).toEqual(["a.o", "zip_slice"]);
  });

  it("tells an archive of traces from an ordinary one", async () => {
    const traces = zipSync({ "trace.systrace": strToU8("# tracer: nop\n"), "app.logcat": strToU8("11-27 09:21:19.123  1  1 I T: a\n11-27 09:21:19.123  1  1 I T: b\n11-27 09:21:19.123  1  1 I T: c\n") });
    expect(await isTraceArchive(new Blob([traces]), "bug.zip")).toBe(true);
    const plain = zipSync({ "readme.txt": strToU8(PLAIN), "main.c": strToU8(C_CODE), "app.log": strToU8(APP_LOG) });
    expect(await isTraceArchive(new Blob([plain]), "src.zip")).toBe(false);
    // One small trace among big other files is not a trace archive.
    const mixed = zipSync({ "t.json": strToU8('{"traceEvents":[]}'), "photo.bin": new Uint8Array(4096).fill(7), "doc.txt": strToU8(PLAIN), "b.txt": strToU8(PLAIN) });
    expect(await isTraceArchive(new Blob([mixed]), "m.zip")).toBe(false);
    const tar = writeTar([{ name: "x.ninja_log", data: strToU8("# ninja log v5\n") }]);
    expect(await isTraceArchive(new Blob([tar as BlobPart]), "x.tar")).toBe(true);
    expect(await isTraceArchive(new Blob([gzipSync(tar)]), "x.tar.gz")).toBe(true);
    expect(await isTraceArchive(new Blob([gzipSync(tar)]), "x.gz")).toBe(false);
  });

  it("gunzips .gz entries to find their kind", () => {
    expect(entryKind("t.fxt.gz", gzipSync(new Uint8Array([0x10, 0, 4, 0x46, 0x78, 0x54, 0x16, 0]))).kind).toBe("fuchsia");
    expect(entryKind("x.bin", new Uint8Array([0, 1, 2, 0, 0])).kind).toBeNull();
  });
});
