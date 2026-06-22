// Generates the app/store image assets from inline SVG (no binary blobs in git).
// Source icons go in assets/ (consumed by @capacitor/assets); store-only graphics go
// in store-assets/. Run: node gen-assets.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("assets", { recursive: true });
mkdirSync("store-assets", { recursive: true });

const GRAD = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
     <stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#22d3ee"/>
   </linearGradient>`;
const GRAD_DARK = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
     <stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#155e75"/>
   </linearGradient>`;

// A document with text lines, centred in a `size` box, page width = frac*size.
function glyph(size, frac = 0.34) {
  const w = size * frac, h = w * 1.32;
  const x = (size - w) / 2, y = (size - h) / 2;
  const pad = w * 0.16, lh = w * 0.12, gap = w * 0.27;
  const ly = y + h * 0.22;
  const line = (i, wf) =>
    `<rect x="${x + pad}" y="${ly + i * gap}" width="${(w - 2 * pad) * wf}" height="${lh}" rx="${lh / 2}" fill="${["#4f46e5", "#6366f1", "#22d3ee"][i]}"/>`;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.13}" fill="#ffffff"/>
    ${line(0, 1)}${line(1, 1)}${line(2, 0.62)}`;
}

const svgIcon = (size, withBg) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>${GRAD("g")}</defs>
  ${withBg ? `<rect width="${size}" height="${size}" fill="url(#g)"/>` : ""}
  ${glyph(size)}
</svg>`;

const svgBg = (size, dark) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>${(dark ? GRAD_DARK : GRAD)("g")}</defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
</svg>`;

const svgSplash = (dark) => `
<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732">
  <defs>${(dark ? GRAD_DARK : GRAD)("g")}</defs>
  <rect width="2732" height="2732" fill="url(#g)"/>
  ${glyph(2732, 0.2)}
</svg>`;

const svgFeature = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
  <defs>${GRAD("g")}</defs>
  <rect width="1024" height="500" fill="url(#g)"/>
  <g transform="translate(-160,-100)">${glyph(700)}</g>
  <text x="430" y="232" font-family="Helvetica, Arial, sans-serif" font-size="104" font-weight="700" fill="#ffffff">Omnitext</text>
  <text x="434" y="300" font-family="Helvetica, Arial, sans-serif" font-size="38" fill="#e0e7ff">Private, offline editor for any file</text>
</svg>`;

const png = (svg) => sharp(Buffer.from(svg)).png();

await png(svgIcon(1024, true)).toFile("assets/icon-only.png");
await png(svgIcon(1024, false)).toFile("assets/icon-foreground.png");
await png(svgBg(1024, false)).toFile("assets/icon-background.png");
await png(svgSplash(false)).toFile("assets/splash.png");
await png(svgSplash(true)).toFile("assets/splash-dark.png");
await png(svgIcon(1024, true)).resize(512, 512).toFile("store-assets/icon-512.png");
await png(svgFeature()).toFile("store-assets/feature-graphic.png");
console.log("assets generated");
