import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The F-Droid build packages the Tesseract engine instead of letting tesseract.js fetch it
// (vite.config.ts, src/ocr-engine.ts). Two of its files are enough only because tesseract.js asks
// for exactly those: the worker, and the SIMD LSTM-only core that OEM 1 selects. If an update
// changes either default, this fails before the packaged build silently goes back to the CDN.
describe("what tesseract.js loads the engine from", () => {
  const core = readFileSync("node_modules/tesseract.js/src/worker-script/browser/getCore.js", "utf8");
  const worker = readFileSync("node_modules/tesseract.js/src/worker/browser/defaultOptions.js", "utf8");
  const config = readFileSync("vite.config.ts", "utf8");

  it("still defaults the worker and the core to jsDelivr", () => {
    expect(worker).toContain("https://cdn.jsdelivr.net/npm/tesseract.js@");
    expect(core).toContain("https://cdn.jsdelivr.net/npm/tesseract.js-core@");
  });

  it("still picks the SIMD LSTM-only core, which is the one the build packages", () => {
    expect(core).toContain("tesseract-core-simd-lstm.wasm.js");
    expect(config).toContain("tesseract-core-simd-lstm.wasm.js");
    expect(config).toContain("tesseract.js/dist/worker.min.js");
  });

  it("takes a full path to a core file as given, without appending a variant name", () => {
    expect(core).toContain("corePathImport.slice(-2) === 'js'");
  });
});
