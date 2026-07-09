// Copies the SubtitlesOctopus (libass WASM) worker + fallback font into
// public/octopus/ so styled ASS subtitle rendering can spawn its worker from a
// same-origin URL. Generated (gitignored); run via predev/prebuild or manually:
//   node scripts/copy-octopus-assets.mjs
import { cpSync, mkdirSync, rmSync } from "node:fs";

const SRC = "node_modules/@jellyfin/libass-wasm/dist/js";
const OUT = "public/octopus";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of ["subtitles-octopus-worker.js", "subtitles-octopus-worker.wasm", "default.woff2", "COPYRIGHT"]) {
  cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
}
console.log("octopus assets copied to public/octopus/");
