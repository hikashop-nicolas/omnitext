import { describe, expect, it } from "vitest";
import { gzipSync } from "fflate";
import { looksLikeCollapsed, looksLikeCpuProfile, looksLikeGeckoProfile, looksLikePerfScript, looksLikeSpeedscope, textProfileKind } from "./profile-detect";
import { looksLikePprof, looksLikeSimpleperf, sniffProfileBytes } from "../core/sniff-profile";
import { sniffFormat } from "../core/sniff";
import { looksLikeChromeTrace } from "./trace-detect";
import { collapsedFormat, cpuProfileFormat, geckoProfileFormat, perfScriptFormat, speedscopeFormat } from "./profiles";
import { jsonFormat } from "./json";
import { chromeTraceFormat } from "./chrometrace";
import { logcatTextFormat, ninjaLogFormat, straceFormat } from "./trace-formats";
import { systraceFormat } from "./systrace";
import { FormatRegistry } from "../core/registries";
import { makeTextFormats } from "./codemirror-formats";
import { pprofBytes, simpleperfBytes, spMeta } from "../editors/profile.fixture";
import { sampleTrace } from "../editors/perfetto-trace.fixture";

const PERF = "app 100/101 [002] 5000.000100: 250000 cpu-clock:u: \n\t    7f00 leaf+0x10 (/usr/lib/libfoo.so)\n\t    7f10 main (/usr/bin/app)\n\n";

/** The format the registry picks for a file name and its text, as the app does when opening. */
function pick(filename: string, sample: string): string | undefined {
  const r = new FormatRegistry();
  for (const f of [...makeTextFormats(), jsonFormat, chromeTraceFormat, systraceFormat, ninjaLogFormat, straceFormat, logcatTextFormat, collapsedFormat, perfScriptFormat, geckoProfileFormat, cpuProfileFormat, speedscopeFormat]) {
    if (!r.byId(f.manifest.id)) r.register(f);
  }
  return r.detect({ filename, sample })?.descriptor.manifest.id;
}

describe("text profile detection", () => {
  it("recognises collapsed stacks, strictly", () => {
    expect(looksLikeCollapsed("main;foo;bar 100\nmain;foo;baz 50\nmain;qux 75\n")).toBe(true);
    expect(looksLikeCollapsed("# comment\nmain;compute 1000\n\nmain;process;work 500\n")).toBe(true);
    // A sample cut mid-line still counts.
    expect(looksLikeCollapsed("a;b 1\na;c 2\na;d 3")).toBe(true);
    // Not collapsed stacks: prose, CSV, one line, numbers without stacks, a stray line in a short file.
    expect(looksLikeCollapsed("Hello world 2\nThis is text 3\n")).toBe(false);
    expect(looksLikeCollapsed("name;age;city\nBob;42;Paris\n")).toBe(false);
    expect(looksLikeCollapsed("a;b 1\n")).toBe(false);
    expect(looksLikeCollapsed("item 1\nitem 2\nother;x 3\n")).toBe(false);
    expect(looksLikeCollapsed("a;b 1\nsomething else\n")).toBe(false);
    expect(looksLikeCollapsed("a;b\t1\na;c\t2\n")).toBe(false);
  });

  it("recognises perf script output, with and without callchains", () => {
    expect(looksLikePerfScript(PERF)).toBe(true);
    expect(looksLikePerfScript("# ========\n# captured on: x\n#\njava  3244 cpu-clock: \n\t    7f1e SpinPause (/lib/libjvm.so)\n\t    7f1f start (/lib/x.so)\n\njava  3245 cpu-clock: \n\t    7f1e SpinPause (/lib/libjvm.so)\n\n")).toBe(true);
    const flat = "a 1 [000] 1.000: 1 cycles:  ffff81 f (/bin/a)\n".repeat(3);
    expect(looksLikePerfScript(flat)).toBe(true);
    expect(looksLikePerfScript("2024-01-01 12:00:00.123: INFO: started\n2024-01-01 12:00:01.000: INFO: done\n")).toBe(false);
    expect(looksLikePerfScript("Some text 12 here: and more\nplain line\n")).toBe(false);
    expect(looksLikePerfScript("# tracer: nop\n  <idle>-0 [000] d..2 1.000: sched_switch: prev_comm=a\n")).toBe(false);
  });

  it("recognises JSON profiles and leaves other JSON alone", () => {
    expect(looksLikeGeckoProfile('{"meta":{"interval":1,"startTime":1,"product":"Firefox","version":24},"threads":[]}')).toBe(true);
    expect(looksLikeGeckoProfile('{"libs":[],"meta":{"abi":"aarch64","interval":1,"startTime":5}}')).toBe(true);
    expect(looksLikeGeckoProfile('{"label":"a","duration":1,"profile":{"libs":[],"meta":{}}}')).toBe(true);
    expect(looksLikeCpuProfile('{"nodes":[{"id":1,"callFrame":{"functionName":"(root)"}}],"samples":[]}')).toBe(true);
    expect(looksLikeCpuProfile('{"head":{"functionName":"(root)","children":[]}}')).toBe(true);
    expect(looksLikeSpeedscope('{"$schema":"https://www.speedscope.app/file-format-schema.json","profiles":[]}')).toBe(true);
    expect(looksLikeSpeedscope('{"shared":{"frames":[]},"profiles":[{"type":"sampled"}]}')).toBe(true);
    for (const other of ['{"meta":{"title":"x"},"data":[1,2]}', '{"nodes":[{"id":1,"label":"x"}],"edges":[]}', '{"profiles":[{"name":"x"}]}', "[1,2,3]"]) {
      expect(textProfileKind(other)).not.toMatch(/gecko|cpuprofile|speedscope/);
    }
  });

  it("routes by name and content the way the app opens a file", () => {
    expect(pick("stacks.txt", "main;foo 1\nmain;bar 2\n")).toBe("collapsed");
    expect(pick("out.folded", "main;foo 1\n")).toBe("collapsed");
    expect(pick("notes.txt", "Hello 2\nWorld 3\n")).toBe("plaintext");
    expect(pick("perf.txt", PERF)).toBe("perfscript");
    expect(pick("profile.json", '{"meta":{"interval":1,"startTime":1,"product":"Firefox"},"threads":[]}')).toBe("geckoprofile");
    expect(pick("x.cpuprofile", '{"nodes":[],"samples":[]}')).toBe("cpuprofile");
    expect(pick("p.json", '{"nodes":[{"id":1,"callFrame":{"functionName":"(root)"}}]}')).toBe("cpuprofile");
    expect(pick("s.speedscope.json", '{"$schema":"https://www.speedscope.app/file-format-schema.json"}')).toBe("speedscope");
    // Chrome traces stay traces, other JSON stays JSON.
    const trace = '{"traceEvents":[{"name":"ProfileChunk","ph":"P","ts":1,"pid":1,"tid":1,"args":{"data":{"cpuProfile":{"nodes":[{"id":1,"callFrame":{"functionName":"(root)"}}]}}}}]}';
    expect(looksLikeChromeTrace(trace)).toBe(true);
    expect(pick("trace.json", trace)).toBe("chrometrace");
    expect(pick("data.json", '{"meta":{"interval":1},"threads":[]}')).toBe("json");
    expect(pick("package.json", '{"name":"x","version":"1.0.0"}')).toBe("json");
  });
});

describe("binary profile detection", () => {
  const pprof = pprofBytes({ types: [["cpu", "nanoseconds"]], functions: ["main"], samples: [{ locs: [1], values: [5] }] });

  it("recognises pprof, gzipped or not, and simpleperf", () => {
    expect(looksLikePprof(pprof)).toBe(true);
    expect(sniffProfileBytes(pprof)).toBe("pprof");
    expect(sniffProfileBytes(gzipSync(pprof))).toBe("pprof");
    const sp = simpleperfBytes([spMeta(["cpu-clock"])]);
    expect(looksLikeSimpleperf(sp)).toBe(true);
    expect(sniffProfileBytes(gzipSync(sp))).toBe("simpleperf");
    expect(sniffFormat(pprof)).toBe("pprof");
    expect(sniffFormat(gzipSync(pprof))).toBe("pprof");
    expect(sniffFormat(sp)).toBe("simpleperf");
  });

  it("leaves other binary data alone", () => {
    // A Perfetto trace is protobuf too, and stays a trace.
    expect(looksLikePprof(sampleTrace())).toBe(false);
    expect(sniffFormat(sampleTrace())).toBe("perfetto");
    expect(sniffProfileBytes(gzipSync(new TextEncoder().encode("just some text, gzipped")))).toBeNull();
    expect(sniffProfileBytes(Uint8Array.from({ length: 512 }, (_, i) => (i * 37) % 256))).toBeNull();
    expect(looksLikePprof(Uint8Array.from([0x0a, 0x02, 0x08, 0x01, 0x12, 0xff, 0xff, 0xff, 0x0f]))).toBe(false);
    expect(looksLikeSimpleperf(new TextEncoder().encode("SIMPLEPERF is a tool"))).toBe(false);
  });
});
