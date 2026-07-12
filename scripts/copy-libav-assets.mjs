// Copies the mediaplay AC-3/E-AC-3 libav decoder (a custom libav.js WASM build) into
// public/libav/ so the media player can spawn its decoder worker + wasm from a
// same-origin URL. Generated (gitignored); run via predev/prebuild or manually:
//   node scripts/copy-libav-assets.mjs
import { cpSync, mkdirSync, rmSync, readdirSync } from "node:fs";

const SRC = "node_modules/mediaplay/libav";
const OUT = "public/libav";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(SRC)) cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
console.log("libav assets copied to public/libav/");
