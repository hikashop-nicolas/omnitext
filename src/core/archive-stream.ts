import { Gunzip, inflateSync } from "fflate";

// Streaming archive reader: keeps the archive as its on-disk Blob and reads only the bytes
// it needs (via Blob.slice), so listing a large archive never decompresses every entry into
// memory. Entries are listed from headers/central-directory; a body is decompressed only
// when read() is called for it. Formats that cannot be streamed here return null from
// openArchiveStream so the caller can fall back to the full-load path.

export interface StreamEntry {
  name: string;
  /** Uncompressed size in bytes (best known from the header). */
  size: number;
  dir: boolean;
}

export interface ArchiveHandle {
  entries: StreamEntry[];
  /** Decompress/extract a single entry by name. Throws if the name is unknown. */
  read(name: string): Promise<Uint8Array>;
}

const u16 = (v: DataView, o: number): number => v.getUint16(o, true);
const u32 = (v: DataView, o: number): number => v.getUint32(o, true);
const u64 = (v: DataView, o: number): number => Number(v.getBigUint64(o, true));

async function sliceBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

// A random-access byte source, backed either by a Blob (reads ranges from disk) or by an
// in-memory buffer (e.g. a gzip stream decompressed once). Lets the tar walker be written
// once for both .tar (blob) and .tar.gz (decompressed buffer).
interface ByteSource {
  size: number;
  slice(start: number, end: number): Promise<Uint8Array>;
}
const blobSource = (blob: Blob): ByteSource => ({ size: blob.size, slice: (s, e) => sliceBytes(blob, s, e) });
const memSource = (buf: Uint8Array): ByteSource => ({
  size: buf.length,
  slice: (s, e) => Promise.resolve(buf.subarray(s, Math.min(e, buf.length))),
});

// --- zip (and jar/cbz) --------------------------------------------------------
// Read the central directory from the tail, so listing needs no entry decompression.

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  dir: boolean;
}

async function openZip(blob: Blob): Promise<ArchiveHandle> {
  // The EOCD is within the last 22 + 65535 (max comment) bytes.
  const tailLen = Math.min(blob.size, 22 + 0xffff);
  const tail = await sliceBytes(blob, blob.size - tailLen, blob.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tv, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: no end-of-central-directory record");

  let cdOffset = u32(tv, eocd + 16);
  let cdSize = u32(tv, eocd + 12);
  let count = u16(tv, eocd + 10);

  // ZIP64: the 32-bit fields are 0xFFFFFFFF sentinels; the real values live in the
  // ZIP64 EOCD, located via the ZIP64 EOCD locator that precedes the classic EOCD.
  if ((cdOffset === 0xffffffff || count === 0xffff) && eocd >= 20 && u32(tv, eocd - 20) === EOCD64_LOC_SIG) {
    const z64Offset = u64(tv, eocd - 20 + 8);
    const z64 = await sliceBytes(blob, z64Offset, z64Offset + 56);
    const zv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength);
    if (u32(zv, 0) === EOCD64_SIG) {
      count = u64(zv, 32);
      cdSize = u64(zv, 40);
      cdOffset = u64(zv, 48);
    }
  }

  const cd = await sliceBytes(blob, cdOffset, cdOffset + cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (u32(cv, p) !== CEN_SIG) break;
    const method = u16(cv, p + 10);
    let compressedSize = u32(cv, p + 20);
    let size = u32(cv, p + 24);
    const nameLen = u16(cv, p + 28);
    const extraLen = u16(cv, p + 30);
    const commentLen = u16(cv, p + 32);
    let localOffset = u32(cv, p + 42);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));

    // Pull 64-bit values from the ZIP64 extra field for any 32-bit field left as a sentinel.
    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let ep = p + 46 + nameLen;
      const extraEnd = ep + extraLen;
      while (ep + 4 <= extraEnd) {
        const id = u16(cv, ep);
        const len = u16(cv, ep + 2);
        let fp = ep + 4;
        if (id === 0x0001) {
          if (size === 0xffffffff) { size = u64(cv, fp); fp += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = u64(cv, fp); fp += 8; }
          if (localOffset === 0xffffffff) { localOffset = u64(cv, fp); fp += 8; }
          break;
        }
        ep += 4 + len;
      }
    }

    entries.push({ name, method, compressedSize, size, localOffset, dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries: entries.map((e) => ({ name: e.name, size: e.size, dir: e.dir })),
    async read(name) {
      const e = byName.get(name);
      if (!e) throw new Error(`zip: no entry ${name}`);
      if (e.dir || e.compressedSize === 0) return new Uint8Array(0);
      // The local header carries its own name/extra lengths (often different from the
      // central directory's), so read them to find where the data actually starts.
      const lh = await sliceBytes(blob, e.localOffset, e.localOffset + 30);
      const lv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
      const dataStart = e.localOffset + 30 + u16(lv, 26) + u16(lv, 28);
      const comp = await sliceBytes(blob, dataStart, dataStart + e.compressedSize);
      if (e.method === 0) return comp; // stored
      if (e.method === 8) return inflateSync(comp); // raw deflate
      throw new Error(`zip: unsupported compression method ${e.method} for ${name}`);
    },
  };
}

// --- tar / tar.gz -------------------------------------------------------------
// Walk 512-byte ustar headers, reading only the headers to list; a body is sliced from the
// source only when read() is called. Handles the name+prefix fields and GNU long names.

const TBLOCK = 512;

const cstr = (b: Uint8Array, off: number, len: number): string => {
  let end = off;
  const max = Math.min(off + len, b.length);
  while (end < max && b[end] !== 0) end++;
  return new TextDecoder().decode(b.subarray(off, end));
};
const octal = (b: Uint8Array, off: number, len: number): number => {
  const s = cstr(b, off, len).trim();
  return s ? parseInt(s, 8) || 0 : 0;
};
const tarName = (h: Uint8Array): string => {
  const name = cstr(h, 0, 100);
  const prefix = cstr(h, 345, 155);
  return prefix ? `${prefix}/${name}` : name;
};

interface TarMeta { name: string; offset: number; size: number; dir: boolean }

async function walkTar(src: ByteSource): Promise<ArchiveHandle> {
  const metas: TarMeta[] = [];
  let p = 0;
  let longName: string | null = null;
  while (p + TBLOCK <= src.size) {
    const h = await src.slice(p, p + TBLOCK);
    if (h.length < TBLOCK || h[0] === 0) break; // zero block ends the archive
    const size = octal(h, 124, 12);
    const typeflag = h[156];
    const dataStart = p + TBLOCK;
    const advance = dataStart + Math.ceil(size / TBLOCK) * TBLOCK;
    if (typeflag === 0x4c) {
      // GNU long name ('L'): this entry's body IS the next entry's full path.
      const nameBytes = await src.slice(dataStart, dataStart + size);
      longName = cstr(nameBytes, 0, nameBytes.length);
      p = advance;
      continue;
    }
    if (typeflag === 0x78 || typeflag === 0x67) {
      // pax extended header ('x'/'g'): skip its body; the following real header wins.
      p = advance;
      continue;
    }
    const name = longName ?? tarName(h);
    longName = null;
    const dir = typeflag === 0x35 || name.endsWith("/"); // '5' = directory
    if (typeflag === 0 || typeflag === 0x30 || typeflag === 0x35) {
      metas.push({ name, offset: dataStart, size, dir });
    }
    p = advance;
  }
  const byName = new Map(metas.map((m) => [m.name, m]));
  return {
    entries: metas.map((m) => ({ name: m.name, size: m.dir ? 0 : m.size, dir: m.dir })),
    async read(name) {
      const m = byName.get(name);
      if (!m) throw new Error(`tar: no entry ${name}`);
      if (m.dir) return new Uint8Array(0);
      return src.slice(m.offset, m.offset + m.size);
    },
  };
}

// .tar.gz / .tgz: gzip is a single non-seekable stream, so decompress it once (streaming the
// compressed bytes off the Blob so we never hold the whole compressed archive), then walk the
// resulting tar in memory. Peak memory is the decompressed tar, not N separate entry copies.
async function openTgz(blob: Blob): Promise<ArchiveHandle> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const gz = new Gunzip((chunk) => {
    chunks.push(chunk);
    total += chunk.length;
  });
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      gz.push(new Uint8Array(0), true);
      break;
    }
    gz.push(value, false);
  }
  const tar = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    tar.set(c, o);
    o += c.length;
  }
  return walkTar(memSource(tar));
}

// --- dispatch -----------------------------------------------------------------

/** Open an archive for streaming listing/extraction, or null if the format isn't supported
    here (the caller then falls back to loading the whole archive). `filename` disambiguates
    a gzip stream (a .tar.gz/.tgz tarball vs a bare single-file .gz). */
export async function openArchiveStream(blob: Blob, filename?: string): Promise<ArchiveHandle | null> {
  if (blob.size < 4) return null;
  // 512 bytes covers the zip/gzip magic at the start and the ustar magic at offset 257.
  const head = await sliceBytes(blob, 0, Math.min(blob.size, 512));

  // zip: "PK" then a local-file (03 04), empty-archive (05 06), or spanned (07 08) marker.
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
    return openZip(blob);
  }
  // tar: "ustar" magic at offset 257 (ustar / gnu / pax all carry it).
  if (head.length >= 262 && cstr(head, 257, 5) === "ustar") {
    return walkTar(blobSource(blob));
  }
  // gzip magic + a tar-ish name means .tar.gz/.tgz; a bare .gz is decompressed elsewhere.
  const name = (filename ?? "").toLowerCase();
  if (head[0] === 0x1f && head[1] === 0x8b && (name.endsWith(".tar.gz") || name.endsWith(".tgz"))) {
    return openTgz(blob);
  }
  // 7z / RAR / xz / bzip2: libarchive must hold the whole archive in WASM memory, so read
  // the bytes here (unavoidable for that reader) and hand off. Loaded lazily so the wasm is
  // never pulled in for a plain zip/tar.
  if (isLibarchiveMagic(head)) {
    const { openLibarchiveStream } = await import("./libarchive");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base = (filename?.split("/").pop() || "archive").replace(/\.[^.]+$/, "");
    return openLibarchiveStream(bytes, base);
  }
  return null;
}

// 7z / RAR (v4+v5) / xz / bzip2 leading magics (kept in sync with core/libarchive.ts). Inlined
// so detection needs no import of the libarchive module (and its wasm) on the zip/tar path.
const LIB_MAGICS: number[][] = [
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
  [0x42, 0x5a, 0x68],
];
const isLibarchiveMagic = (head: Uint8Array): boolean => LIB_MAGICS.some((m) => m.every((b, i) => head[i] === b));
