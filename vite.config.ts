import { execSync } from "node:child_process";
import { defineConfig } from "vite";

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
 */
const dropUnusedOrtWasm = {
  name: "omnitext-drop-unused-ort-wasm",
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(file)) delete bundle[file];
  },
};

export default defineConfig({
  base: "./",
  plugins: [dropUnusedOrtWasm],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // pdfedit (local dep) and the app both use pdf.js/pdf-lib; keep one copy each.
  // jsdom: notebookjs statically references it in a Node-only branch that never runs in
  // the browser; alias it to a tiny stub so the ~3MB dep is not bundled.
  resolve: {
    // three: the 3D model viewer and dxf-viewer both use it; keep a single instance so
    // cross-instance objects (e.g. a THREE.Color passed to dxf-viewer) work correctly.
    dedupe: ["pdfjs-dist", "pdf-lib", "three"],
    alias: { jsdom: new URL("./src/vendor/jsdom-stub.ts", import.meta.url).pathname },
  },
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
