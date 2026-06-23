import { defineConfig } from "vite";

// Static-site build for GitHub Pages. base is "./" so the app works from any
// repo-subpath without rewriting asset URLs.
export default defineConfig({
  base: "./",
  // pdfedit (local dep) and the app both use pdf.js/pdf-lib; keep one copy each.
  resolve: { dedupe: ["pdfjs-dist", "pdf-lib"] },
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
