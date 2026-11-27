import { describe, expect, it } from "vitest";
import { gzipSync, strToU8, zlibSync } from "fflate";
import { looksLikeChromeTrace } from "traceview";
import { sniffFormat, sniffHead } from "../core/sniff";
import { collapsedFormat, cpuProfileFormat, geckoProfileFormat, perfScriptFormat, pprofFormat, speedscopeFormat } from "./profiles";
import { jsonFormat } from "./json";
import { chromeTraceFormat } from "./chrometrace";
import { ctraceFormat, fuchsiaTraceFormat, logcatTextFormat, ninjaLogFormat, straceFormat } from "./trace-formats";
import { systraceFormat } from "./systrace";
import { FormatRegistry } from "../core/registries";
import { makeTextFormats } from "./codemirror-formats";
import { perfettoBytes, pprofBytes, simpleperfBytes } from "./trace-samples.fixture";

// How the app routes trace and profile files to their viewers; traceview tests the readers.

const PERF = "app 100/101 [002] 5000.000100: 250000 cpu-clock:u: \n\t    7f00 leaf+0x10 (/usr/lib/libfoo.so)\n\t    7f10 main (/usr/bin/app)\n\n";
const PLAIN = "Shopping list\nmilk\neggs\nbread (two loaves)\nbutter\ncall mum: about Sunday\n";
const C_CODE = "int main(void) {\n  int fd = open(\"x\", O_RDONLY);\n  read(fd, buf, 3);\n  close(fd);\n  return 0;\n}\n";
const APP_LOG = "2026-11-27 09:21:19,123 INFO server: started\n2026-11-27 09:21:20,001 WARN db: slow query\n2026-11-27 09:21:21,500 ERROR api: timeout\n";

/** The format the registry picks for a file name and its text, as the app does when opening. */
function pick(filename: string, sample: string): string | undefined {
  const r = new FormatRegistry();
  for (const f of [...makeTextFormats(), jsonFormat, chromeTraceFormat, systraceFormat, ninjaLogFormat, straceFormat, logcatTextFormat, collapsedFormat, perfScriptFormat, geckoProfileFormat, cpuProfileFormat, speedscopeFormat]) {
    if (!r.byId(f.manifest.id)) r.register(f);
  }
  return r.detect({ filename, sample })?.descriptor.manifest.id;
}

describe("trace and profile routing", () => {
  it("routes text profiles by name and content", () => {
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

  it("claims text traces strictly", () => {
    const json = '{"traceEvents":[{"name":"A","ph":"X","ts":1,"dur":2,"pid":1,"tid":1}]}';
    expect(chromeTraceFormat.detect({ sample: json, filename: "trace.json" })).toBeGreaterThan(0.78);
    expect(chromeTraceFormat.detect({ sample: '{"a":1}', filename: "a.json" })).toBe(0);
    expect(systraceFormat.detect({ sample: "# tracer: nop\n#\n", filename: "trace.txt" })).toBeGreaterThan(0.95);
    expect(ninjaLogFormat.detect({ sample: PLAIN })).toBe(0);
    expect(ninjaLogFormat.detect({ sample: "# ninja log v5\n" })).toBeGreaterThan(0.95);
    expect(straceFormat.detect({ sample: C_CODE })).toBe(0);
    const tt = "11-27 09:21:19.123  1234  5678 I ActivityManager: a\n11-27 09:21:19.200  1234  5678 D Tag     : b\n11-27 09:21:19.300  1234  5679 E Other: c\n";
    expect(logcatTextFormat.detect({ sample: APP_LOG })).toBe(0);
    expect(logcatTextFormat.detect({ sample: tt })).toBeGreaterThan(0.95);
  });

  it("knows binary traces and profiles by their bytes", () => {
    const fxt = new Uint8Array([0x10, 0, 4, 0x46, 0x78, 0x54, 0x16, 0, 0, 0, 0, 0]);
    expect(sniffHead(fxt)).toBe("fuchsia");
    expect(fuchsiaTraceFormat.sniffBytes!(fxt)).toBe(true);
    const head = strToU8("capturing trace... done\nTRACE:\n");
    const z = zlibSync(strToU8("# tracer: nop\n"));
    const ctrace = new Uint8Array(head.length + z.length);
    ctrace.set(head);
    ctrace.set(z, head.length);
    expect(sniffHead(ctrace)).toBe("ctrace");
    expect(ctraceFormat.sniffBytes!(ctrace)).toBe(true);
    expect(sniffFormat(perfettoBytes())).toBe("perfetto");
    expect(sniffFormat(pprofBytes())).toBe("pprof");
    expect(sniffFormat(gzipSync(pprofBytes()))).toBe("pprof");
    expect(pprofFormat.sniffBytes!(pprofBytes())).toBe(true);
    expect(sniffFormat(simpleperfBytes())).toBe("simpleperf");
  });
});
