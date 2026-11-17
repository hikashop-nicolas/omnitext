// The largest JPEG preview embedded in a camera RAW file. Cameras store their previews as
// ordinary JPEGs (CR2 IFD0, NEF and DNG SubIFDs, CR3 PRVW, RAF header...), so a scan for JPEG
// streams finds them whatever the container. Lossless JPEG (the sensor data in CR2 and DNG)
// is skipped: browsers cannot decode it.

/** Baseline, extended and progressive DCT: what an <img> can show. */
const DECODABLE_SOF = new Set([0xc0, 0xc1, 0xc2]);
const OTHER_SOF = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

interface Found {
  start: number;
  end: number;
  area: number;
}

/** The JPEG stream starting at `start` (an FF D8), or null if it is not one we can show. */
function readJpeg(b: Uint8Array, start: number): Found | null {
  let i = start + 2;
  let area = -1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0xd9 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) return null;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2) return null;
    if (OTHER_SOF.has(m)) return null;
    if (DECODABLE_SOF.has(m) && i + 9 <= b.length) area = ((b[i + 5]! << 8) | b[i + 6]!) * ((b[i + 7]! << 8) | b[i + 8]!);
    if (m === 0xda) {
      if (area <= 0) return null;
      // entropy-coded data until a marker that is neither a stuffed byte nor a restart
      let j = i + 2 + len;
      while (j + 1 < b.length) {
        if (b[j] === 0xff) {
          const n = b[j + 1]!;
          if (n === 0xd9) return { start, end: j + 2, area };
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) {
            if (n === 0xda || (n >= 0xc4 && n <= 0xcf) || n === 0xdb || n === 0xdd) { i = j; break; } // next scan of a progressive JPEG
            return null;
          }
        }
        j++;
      }
      if (j + 1 >= b.length) return null;
      continue;
    }
    i += 2 + len;
  }
  return null;
}

export function largestPreview(bytes: Uint8Array): Uint8Array | null {
  let best: Found | null = null;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    const f = readJpeg(bytes, i);
    if (!f) continue;
    if (!best || f.area > best.area || (f.area === best.area && f.end - f.start > best.end - best.start)) best = f;
    i = f.end - 1;
  }
  return best ? bytes.subarray(best.start, best.end) : null;
}
