import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The F-Droid build packages the Tesseract engine instead of letting tesseract.js fetch it
// (vite.config.ts, src/ocr-engine.ts). Which files are enough depends on what tesseract.js asks
// for: the worker, and the two LSTM-only cores that OEM 1 selects between by wasm SIMD. If an
// update changes those names, this fails before the packaged build goes quietly back to the CDN.
describe("what tesseract.js loads the engine from", () => {
  const core = readFileSync("node_modules/tesseract.js/src/worker-script/browser/getCore.js", "utf8");
  const worker = readFileSync("node_modules/tesseract.js/src/worker/browser/defaultOptions.js", "utf8");
  const config = readFileSync("vite.config.ts", "utf8");

  it("still defaults the worker and the core to jsDelivr", () => {
    expect(worker).toContain("https://cdn.jsdelivr.net/npm/tesseract.js@");
    expect(core).toContain("https://cdn.jsdelivr.net/npm/tesseract.js-core@");
  });

  it("still names both LSTM-only cores, which are the ones the build packages", () => {
    for (const name of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) {
      expect(core, name).toContain(name);
      expect(config, name).toContain(name);
    }
    expect(config).toContain("tesseract.js/dist/worker.min.js");
  });

  it("chooses between them from a folder, which is what the build points at", () => {
    const engine = readFileSync("src/ocr-engine.ts", "utf8");
    expect(core).toContain("await simd()");
    expect(engine).toContain('corePath: at("")');
  });

  it("takes a full path to a core file as given, without appending a variant name", () => {
    expect(core).toContain("corePathImport.slice(-2) === 'js'");
  });
});
