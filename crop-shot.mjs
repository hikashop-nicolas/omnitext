// Crop a phone screencap to remove the Android status/nav bars and meet Play's
// max 2:1 aspect. Usage: node crop-shot.mjs <in.png> <out.png>
import sharp from "sharp";
const [,, inp, out] = process.argv;
const m = await sharp(inp).metadata();
const top = Math.round(m.height * 0.03);          // drop the status bar
const height = Math.min(m.width * 2, m.height - top); // cap at 2:1, drop the nav bar
await sharp(inp).extract({ left: 0, top, width: m.width, height }).png().toFile(out);
console.log(`${out}: ${m.width}x${height}`);
