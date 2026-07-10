import { defineConfig } from "vite";

// Static-site build for GitHub Pages. base is "./" so the app works from any
// repo-subpath without rewriting asset URLs.
export default defineConfig({
  base: "./",
  // pdfedit (local dep) and the app both use pdf.js/pdf-lib; keep one copy each.
  // jsdom: notebookjs statically references it in a Node-only branch that never runs in
  // the browser; alias it to a tiny stub so the ~3MB dep is not bundled.
  resolve: {
    dedupe: ["pdfjs-dist", "pdf-lib"],
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
  },
});
