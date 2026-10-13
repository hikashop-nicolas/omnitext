// Load the Tesseract OCR engine from the package rather than from jsDelivr, in the build that
// ships it. Only the F-Droid build does (OMNITEXT_BUNDLE_TESSERACT=1, see vite.config.ts); in
// every other build the define is empty, nothing is installed, and OCR downloads the engine on
// first use behind the consent prompt as before.
import { setOcrEnginePaths } from "localml/ocr-paths";

declare const __TESSERACT_ENGINE_DIR__: string | undefined;

export function installBundledOcrEngine(): void {
  const dir = typeof __TESSERACT_ENGINE_DIR__ === "string" ? __TESSERACT_ENGINE_DIR__ : "";
  if (!dir) return;
  const at = (file: string) => new URL(dir + file, document.baseURI).href;
  // The folder, not one core: tesseract.js picks the SIMD build or the plain one by what the
  // engine supports, and both are packaged, so neither case reaches the CDN.
  setOcrEnginePaths({ workerPath: at("worker.min.js"), corePath: at("") });
}
