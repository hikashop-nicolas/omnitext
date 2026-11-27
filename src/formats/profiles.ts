import type { FormatDescriptor, FormatManifest } from "../core/types";
import { looksLikePprof, looksLikeSimpleperf } from "../core/sniff-profile";
import { looksLikeCollapsed, looksLikeCpuProfile, looksLikeGeckoProfile, looksLikePerfScript, looksLikeSpeedscope } from "./profile-detect";

// CPU and sampling profiles, all shown read-only in the profile viewer. Text profiles are
// recognised by content (strictly, so other text and JSON keep their editors).

const manifest = (id: string, extensions: string[], binary = false): FormatManifest => ({
  kind: "format",
  id,
  extensions,
  nativeEditor: "profileviewer",
  defaultEditor: "profileviewer",
  ...(binary ? { binary: true, soleEditor: true } : {}),
});

const load = () => import("./profile.impl").then((m) => m.profileImpl);

/** Brendan Gregg's collapsed ("folded") stacks: "a;b;c 12" per line. */
export const collapsedFormat: FormatDescriptor = {
  manifest: manifest("collapsed", [".folded", ".collapsed"]),
  // Above plain text's .txt claim: a strict match is a profile.
  detect: ({ sample }) => (looksLikeCollapsed(sample) ? 0.97 : 0),
  load,
};

/** `perf script` and `simpleperf report-sample` text output. */
export const perfScriptFormat: FormatDescriptor = {
  manifest: manifest("perfscript", [".perf", ".perfscript"]),
  detect: ({ sample }) => (looksLikePerfScript(sample) ? 0.97 : 0),
  load,
};

/** Firefox Profiler (Gecko) JSON, from Firefox, samply or the profiler itself. */
export const geckoProfileFormat: FormatDescriptor = {
  manifest: manifest("geckoprofile", []),
  detect: ({ sample }) => (looksLikeGeckoProfile(sample) ? 0.92 : 0),
  load,
};

/** Chrome DevTools and Node .cpuprofile. */
export const cpuProfileFormat: FormatDescriptor = {
  manifest: manifest("cpuprofile", [".cpuprofile"]),
  detect: ({ sample }) => (looksLikeCpuProfile(sample) ? 0.92 : 0),
  load,
};

/** speedscope's own JSON format. */
export const speedscopeFormat: FormatDescriptor = {
  manifest: manifest("speedscope", []),
  detect: ({ sample }) => (looksLikeSpeedscope(sample) ? 0.92 : 0),
  load,
};

/** pprof Profile protobuf, gzipped or not (Go, and the many tools writing it). */
export const pprofFormat: FormatDescriptor = {
  manifest: manifest("pprof", [".pprof"], true),
  detect: () => 0,
  sniffBytes: (head) => (head[0] === 0x1f && head[1] === 0x8b) || looksLikePprof(head),
  load,
};

/** Android simpleperf report-sample --protobuf output (also Android Studio's native traces). */
export const simpleperfFormat: FormatDescriptor = {
  manifest: manifest("simpleperf", [], true),
  detect: () => 0,
  sniffBytes: looksLikeSimpleperf,
  load,
};

export const profileFormats = [collapsedFormat, perfScriptFormat, geckoProfileFormat, cpuProfileFormat, speedscopeFormat, pprofFormat, simpleperfFormat];
