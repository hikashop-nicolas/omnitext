// Minimal USTAR tar reader/writer (no deps), enough to browse and rewrite tar archives.
// Handles regular files (typeflag '0'/'\0') with the standard name + prefix fields; skips
// directories and other entry types. Tar stores no compression: .tar.gz/.tgz are gzip(tar),
// handled by the caller via fflate.

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

const BLOCK = 512;
const dec = new TextDecoder();
const enc = new TextEncoder();

function str(bytes: Uint8Array, off: number, len: number): string {
  let end = off;
  const max = off + len;
  while (end < max && bytes[end] !== 0) end++;
  return dec.decode(bytes.subarray(off, end));
}

function octal(bytes: Uint8Array, off: number, len: number): number {
  const s = str(bytes, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

/** Parse a tar buffer into its regular-file entries. */
export function readTar(bytes: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let p = 0;
  while (p + BLOCK <= bytes.length) {
    // End of archive: a zero block (name byte 0).
    if (bytes[p] === 0) break;
    const name = str(bytes, p, 100);
    const size = octal(bytes, p + 124, 12);
    const typeflag = bytes[p + 156];
    const prefix = str(bytes, p + 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    const dataStart = p + BLOCK;
    if ((typeflag === 0 || typeflag === 0x30) && !full.endsWith("/")) {
      out.push({ name: full, data: bytes.subarray(dataStart, dataStart + size) });
    }
    p = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

function header(name: string, size: number): Uint8Array {
  const h = new Uint8Array(BLOCK);
  let nm = name;
  let prefix = "";
  if (enc.encode(nm).length > 100) {
    const cut = nm.lastIndexOf("/", nm.length - 1);
    if (cut > 0) {
      prefix = nm.slice(0, cut);
      nm = nm.slice(cut + 1);
    }
  }
  h.set(enc.encode(nm).subarray(0, 100), 0);
  h.set(enc.encode("000644 ").subarray(0, 7), 100); // mode
  h.set(enc.encode("000000 ").subarray(0, 7), 108); // uid
  h.set(enc.encode("000000 ").subarray(0, 7), 116); // gid
  h.set(enc.encode(size.toString(8).padStart(11, "0") + " "), 124); // size (octal)
  h.set(enc.encode("00000000000 "), 136); // mtime (0)
  h[156] = 0x30; // typeflag '0' (regular file)
  h.set(enc.encode("ustar\0"), 257);
  h.set(enc.encode("00"), 263); // version
  if (prefix) h.set(enc.encode(prefix).subarray(0, 155), 345);
  // Checksum: sum of all bytes with the checksum field treated as spaces.
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i]!;
  h.set(enc.encode(sum.toString(8).padStart(6, "0")), 148);
  h[154] = 0; // NUL
  h[155] = 0x20; // space
  return h;
}

/** Build a tar buffer from entries (regular files only). */
export function writeTar(entries: TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const e of entries) {
    const h = header(e.name, e.data.length);
    parts.push(h);
    parts.push(e.data);
    const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(new Uint8Array(pad));
    total += h.length + e.data.length + pad;
  }
  const trailer = new Uint8Array(BLOCK * 2); // two zero blocks end the archive
  total += trailer.length;
  parts.push(trailer);
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}
