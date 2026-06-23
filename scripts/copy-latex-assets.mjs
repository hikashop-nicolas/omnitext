// Copies the latex.js stylesheets + KaTeX woff2 math fonts into public/latexjs/ so the
// LaTeX preview can load them at runtime (in a shadow root). Deliberately ships woff2 ONLY:
// the KaTeX math fonts have woff2 (~0.3MB), but the Computer Modern body fonts are woff-only
// (~7MB) - too heavy, so body text falls back to a system serif. A stub fonts/cmu.css keeps
// base.css's @import from 404-ing. Re-run after bumping latex.js: node scripts/copy-latex-assets.mjs
import { mkdirSync, copyFileSync, writeFileSync, readdirSync } from "node:fs";

const SRC = "node_modules/latex.js/dist";
const OUT = "public/latexjs";

mkdirSync(`${OUT}/css`, { recursive: true });
mkdirSync(`${OUT}/fonts`, { recursive: true });

for (const css of ["base.css", "article.css", "book.css", "katex.css"]) {
  copyFileSync(`${SRC}/css/${css}`, `${OUT}/css/${css}`);
}
let n = 0;
for (const f of readdirSync(`${SRC}/fonts`)) {
  if (f.endsWith(".woff2")) {
    copyFileSync(`${SRC}/fonts/${f}`, `${OUT}/fonts/${f}`);
    n++;
  }
}
// Stub for base.css's `@import url("../fonts/cmu.css")` (we do not ship Computer Modern).
writeFileSync(`${OUT}/fonts/cmu.css`, "/* Computer Modern body fonts omitted (woff-only, ~7MB); body falls back to a system serif. */\n");
console.log(`latex assets: 4 css + ${n} woff2 fonts -> ${OUT}`);
