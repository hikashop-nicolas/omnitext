// Load the Tesseract OCR engine from the package rather than from jsDelivr, in the build that
// ships it. Only the F-Droid build does (OMNITEXT_BUNDLE_TESSERACT=1, see vite.config.ts); in
// every other build the define is empty, nothing is installed, and OCR downloads the engine on
// first use behind the consent prompt as before.
import { setOcrEnginePaths } from "localml/ocr-paths";

declare const __TESSERACT_ENGINE_DIR__: string | undefined;

// wasm-feature-detect's SIMD probe, the test tesseract.js itself runs: a module whose body is
// one v128 instruction. Every engine since 2021 passes it.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export function installBundledOcrEngine(): void {
  const dir = typeof __TESSERACT_ENGINE_DIR__ === "string" ? __TESSERACT_ENGINE_DIR__ : "";
  // The packaged core is the SIMD build; without SIMD, leave the CDN path in place.
  if (!dir || !WebAssembly.validate(SIMD_PROBE)) return;
  const at = (file: string) => new URL(dir + file, document.baseURI).href;
  setOcrEnginePaths({
    workerPath: at("worker.min.js"),
    corePath: at("tesseract-core-simd-lstm.wasm.js"),
  });
}
