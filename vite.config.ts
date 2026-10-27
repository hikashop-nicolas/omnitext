import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import {
  ORT_BACKEND_MODULE,
  ORT_ENGINE_DIR,
  ORT_ENGINE_FILES,
  rewriteOnnxBackend,
} from "./src/onnxruntime-engine.ts";

/**
 * What build this is, so two peers can tell whether they are running the same code.
 *
 * The commit, because that is what pins every editor library in the lockfile. Two peers on
 * the same commit parse a PDF into the same paragraphs, which is what makes an edit keyed
 * by paragraph index mean the same thing on both sides. A dev server reports "dev": two
 * developers can differ while both saying so, and that is a known hole rather than a
 * pretence of safety.
 */
function buildId(): string {
  if (process.env.NODE_ENV !== "production") return "dev";
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// Static-site build for GitHub Pages. base is "./" so the app works from any
// repo-subpath without rewriting asset URLs.
/**
 * onnxruntime-web's module references its own 23.5 MB wasm, so Vite emits it, but it is never
 * loaded: transformers.js points onnxruntime at jsDelivr (behind the download prompt). It was 5.7 MB
 * of the 28 MB app bundle, and 23.5 MB (5.5 MB compressed) of what the service worker pre-downloads
 * for every web visitor. src/onnxruntime-source.test.ts fails if transformers.js ever stops doing that.
 * The engine the F-Droid build packages is emitted under ORT_ENGINE_DIR and is not one of these.
 */
const dropUnusedOrtWasm = {
  name: "omnitext-drop-unused-ort-wasm",
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) {
      if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(file) && !file.startsWith(ORT_ENGINE_DIR)) delete bundle[file];
    }
  },
};

/**
 * The F-Droid build ships the onnxruntime engine instead of letting transformers.js fetch it from
 * jsDelivr on first use, because F-Droid's inclusion policy objects to downloading executable
 * code. With OMNITEXT_BUNDLE_ONNXRUNTIME=1 the two files it names are emitted into dist/ort/ and
 * its own source is rewritten to look there (src/onnxruntime-engine.ts). Every other build is
 * untouched and keeps the download, behind the consent prompt, as before.
 *
 * The files are emitted rather than imported so that nothing can drag them into those bundles.
 */
const bundleOnnxruntime = process.env.OMNITEXT_BUNDLE_ONNXRUNTIME === "1";
// Also a worker plugin: transformers.js is imported only inside the three AI workers, and a
// build-time worker bundle does not inherit the main plugin list.
const pointOnnxruntimeAtPackage: Plugin = {
  name: "omnitext-onnxruntime-engine-path",
  transform(code, id) {
    if (!bundleOnnxruntime || !id.includes(ORT_BACKEND_MODULE)) return null;
    return { code: rewriteOnnxBackend(code), map: null };
  },
};
const bundleOnnxruntimeEngine: Plugin = {
  name: "omnitext-bundle-onnxruntime",
  generateBundle() {
    if (!bundleOnnxruntime) return;
    for (const file of ORT_ENGINE_FILES) {
      this.emitFile({
        type: "asset",
        fileName: ORT_ENGINE_DIR + file,
        source: readFileSync(`node_modules/onnxruntime-web/dist/${file}`),
      });
    }
  },
};

/**
 * The F-Droid build ships the Tesseract OCR engine instead of fetching it from jsDelivr on first
 * use, because F-Droid's inclusion policy objects to downloading executable code. With
 * OMNITEXT_BUNDLE_TESSERACT=1 the engine is emitted into dist/tesseract/ and
 * __TESSERACT_ENGINE_DIR__ names that folder, which is what src/ocr-engine.ts acts on. Every other
 * build leaves the define empty and keeps the download (behind the consent prompt) as before.
 *
 * Both LSTM-only cores, the SIMD one and the plain one: OEM 1 is how localml creates its worker,
 * so those are the two tesseract.js can ask for, and a WebView older than wasm SIMD (before
 * Chrome 91) would otherwise fall back to the CDN. The two Tesseract cores that carry the legacy
 * engine are never loaded, so they stay out.
 */
const bundleTesseract = process.env.OMNITEXT_BUNDLE_TESSERACT === "1";
const TESSERACT_ENGINE_DIR = "tesseract/";
const TESSERACT_ENGINE_FILES = [
  "tesseract.js/dist/worker.min.js",
  "tesseract.js/dist/worker.min.js.LICENSE.txt",
  "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "tesseract.js-core/tesseract-core-lstm.wasm.js",
];
const bundleTesseractEngine: Plugin = {
  name: "omnitext-bundle-tesseract",
  generateBundle() {
    if (!bundleTesseract) return;
    for (const file of TESSERACT_ENGINE_FILES) {
      this.emitFile({
        type: "asset",
        fileName: TESSERACT_ENGINE_DIR + file.split("/").pop(),
        source: readFileSync(`node_modules/${file}`),
      });
    }
  },
};

/**
 * The PDF editor runs on PdfCraft's engine, compiled to wasm, through craftbridge. A build finds
 * craftbridge with its wasm built through CRAFTBRIDGE_DIR (scripts/build-craftbridge.sh makes it)
 * and refuses to go on without it, unless OMNITEXT_NO_PDF_ENGINE=1 asks for a build with no PDF
 * editor (quick local work; the tests run on a stub too).
 */
const craftDir = resolve(process.env.CRAFTBRIDGE_DIR ?? "node_modules/craftbridge");
const craftReady =
  existsSync(`${craftDir}/wasm/pdf/pdfcraft_wasm_bg.wasm`) && existsSync(`${craftDir}/src/pdf/index.ts`);
const craftAliases = craftReady
  ? [
      { find: /^craftbridge\/pdf\/worker/, replacement: `${craftDir}/src/pdf/worker.ts` },
      { find: /^craftbridge\/pdf$/, replacement: `${craftDir}/src/pdf/index.ts` },
    ]
  : [
      { find: /^craftbridge\/pdf\/worker/, replacement: new URL("./src/stubs/craftbridge-pdf-worker.ts", import.meta.url).pathname },
      { find: /^craftbridge\/pdf$/, replacement: new URL("./src/stubs/craftbridge-pdf.ts", import.meta.url).pathname },
    ];

if (!craftReady && process.argv.includes("build") && !process.env.OMNITEXT_NO_PDF_ENGINE) {
  throw new Error("The PDF engine is not built: run scripts/build-craftbridge.sh and set CRAFTBRIDGE_DIR=$PWD/vendor/craftbridge (OMNITEXT_NO_PDF_ENGINE=1 builds without a PDF editor).");
}

export default defineConfig({
  base: "./",
  plugins: [dropUnusedOrtWasm, bundleTesseractEngine, pointOnnxruntimeAtPackage, bundleOnnxruntimeEngine],
  worker: { plugins: () => [pointOnnxruntimeAtPackage] },
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __CRAFT_PDF__: JSON.stringify(craftReady),
    __TESSERACT_ENGINE_DIR__: JSON.stringify(bundleTesseract ? TESSERACT_ENGINE_DIR : ""),
  },
  // the editors and the app both use pdf.js/pdf-lib; keep one copy each.
  // jsdom: notebookjs statically references it in a Node-only branch that never runs in
  // the browser; alias it to a tiny stub so the ~3MB dep is not bundled.
  resolve: {
    // three: the 3D model viewer and dxf-viewer both use it; keep a single instance so
    // cross-instance objects (e.g. a THREE.Color passed to dxf-viewer) work correctly.
    dedupe: ["pdfjs-dist", "pdf-lib", "three"],
    alias: [{ find: "jsdom", replacement: new URL("./src/vendor/jsdom-stub.ts", import.meta.url).pathname }, ...craftAliases],
  },
  server: { fs: { allow: [".", craftDir] } },
  // esbuild's dep pre-bundling mangles temml (richdoc's equation editor), making it error on every
  // LaTeX command; serve its raw ESM instead.
  optimizeDeps: { exclude: ["temml"] },
  build: {
    target: "es2022",
    // No sourcemaps in the shipped build: they were ~18MB of the dist (two-thirds of it),
    // bloating the APK and publishing source on Pages. The dev server still has its own.
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/vendor/test-setup.ts"],
    // The libarchive wasm is imported as a URL for the browser. Under node that string has
    // to be a filesystem path instead, or emscripten looks for it at the filesystem root.
    // Aliased here rather than made configurable in the app: it is the test environment
    // that differs, not the code.
    alias: [
      {
        find: "libarchive-wasm/dist/libarchive.wasm?url",
        replacement: new URL("./src/vendor/libarchive-wasm-url.ts", import.meta.url).pathname,
      },
      {
        find: "7z-wasm/7zz.wasm?url",
        replacement: new URL("./src/vendor/sevenzip-wasm-url.ts", import.meta.url).pathname,
      },
    ],
  },
});
