// Load the onnxruntime engine from the package rather than from jsDelivr, in the build that ships
// it. Only the F-Droid build does (OMNITEXT_BUNDLE_ONNXRUNTIME=1, see vite.config.ts); in every
// other build nothing here runs and the AI features download the engine on first use behind the
// consent prompt as before. Models are untouched: they keep coming from huggingface.co.
//
// A rewrite of transformers.js's own source rather than a call at startup, as OCR gets: it picks
// the URLs inside three separate workers (localml's translate and generate, subedit's whisper),
// and a worker's environment cannot be set from the main thread.

/** Where the engine is emitted, relative to dist. */
export const ORT_ENGINE_DIR = "ort/";

/**
 * The two files transformers.js names: the wasm and its .mjs glue. Only the asyncify variant,
 * which is the pair it asks for everywhere except an old Safari without WebGPU. No proxy
 * worker: it pins env.backends.onnx.wasm.proxy to false.
 */
export const ORT_ENGINE_FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];

/** The transformers.js file that chooses those URLs: the bundle browsers get, not its sources. */
export const ORT_BACKEND_MODULE = "@huggingface/transformers/dist/transformers.web.js";

const CDN_PREFIX =
  "const wasmPathPrefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_ENV.versions.web}/dist/`;";
// It drops the .asyncify suffix for an old Safari without WebGPU, a pair we do not package.
const SAFARI_SUFFIX = 'if (apis.IS_SAFARI_BELOW_26 && !apis.IS_WEBGPU_AVAILABLE) {';

/**
 * Point transformers.js at the packaged engine. Resolved against the importing chunk's own URL,
 * since the code runs in workers rather than in the document, and every chunk sits one folder
 * below dist. The Safari branch is disabled because the pair it picks is not packaged.
 *
 * Throws if either anchor is gone, so an upgrade fails the build instead of quietly going back
 * to the CDN.
 */
export function rewriteOnnxBackend(code: string): string {
  for (const anchor of [CDN_PREFIX, SAFARI_SUFFIX]) {
    if (!code.includes(anchor)) throw new Error(`${ORT_BACKEND_MODULE}: cannot find ${anchor}`);
  }
  const dir = JSON.stringify(`../${ORT_ENGINE_DIR}`);
  return code
    .replace(CDN_PREFIX, `const ortEngineDir = ${dir};\nconst wasmPathPrefix = new URL(ortEngineDir, import.meta.url).href;`)
    .replace(SAFARI_SUFFIX, "if (false) {");
}
