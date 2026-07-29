// Copies the mediaplay ALAC decoder (a WASM build of Apple's reference decoder) into
// public/alac/ so the media player can load it from a same-origin URL. Only Safari decodes
// Apple Lossless natively; everywhere else this is what makes an .m4a of ALAC play.
// Generated (gitignored); run via predev/prebuild or manually:
//   node scripts/copy-alac-assets.mjs
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";

const SRC = "node_modules/mediaplay/alac/dist";
const OUT = "public/alac";

if (!existsSync(SRC)) {
  console.error(`${SRC} is missing: mediaplay must be new enough to ship its ALAC decoder.`);
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(SRC)) cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
console.log("ALAC assets copied to public/alac/");
