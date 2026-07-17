import { ArchiveReader, libarchiveWasm } from "libarchive-wasm";
import wasmUrl from "libarchive-wasm/dist/libarchive.wasm?url";
import type { ArchiveEntry } from "./archive";
import type { ArchiveHandle } from "./archive-stream";

// Extraction for archive/compression formats the fflate + tar path can't handle: 7z, RAR,
// xz, bzip2 (including tar wrapped in xz/bzip2). Backed by libarchive compiled to WASM
// (BSD-2 core), loaded lazily on demand and run entirely in the browser. Extraction only,
// which is all the archive viewer needs. (This libarchive build has no zstd/lz4 support.)

// Leading magic bytes for the formats we route here (fflate handles zip/gzip/tar itself).
const MAGICS: number[][] = [
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], // RAR (v4 and v5 share this prefix)
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz
  [0x42, 0x5a, 0x68], // bzip2 "BZh"
];

/** True when the bytes are a format libarchive should handle rather than fflate. */
export function isLibarchiveArchive(bytes: Uint8Array): boolean {
  return MAGICS.some((m) => m.every((b, i) => bytes[i] === b));
}

let modPromise: Promise<Awaited<ReturnType<typeof libarchiveWasm>>> | null = null;
function loadModule() {
  if (!modPromise) modPromise = libarchiveWasm({ locateFile: () => wasmUrl });
  return modPromise;
}

/** List and read an archive's entries via libarchive. fallbackName names a single
 *  unnamed entry (e.g. a bare .xz of one file). */
export async function extractWithLibarchive(
  bytes: Uint8Array,
  fallbackName: string,
): Promise<ArchiveEntry[]> {
  const mod = await loadModule();
  // ArchiveReader wants an Int8Array of just this document's bytes.
  const data = new Int8Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const reader = new ArchiveReader(mod, data);
  const entries: ArchiveEntry[] = [];
  try {
    for (const entry of reader.entries()) {
      const name = entry.getPathname();
      if (name.endsWith("/")) continue; // directory
      const raw = entry.readData();
      // Copy out of WASM memory (the buffer is reused for the next entry).
      entries.push({ name: name || fallbackName, data: raw ? new Uint8Array(raw) : new Uint8Array(0) });
    }
  } finally {
    reader.free();
  }
  return entries;
}

/** Stream-style handle for libarchive formats: list names + sizes from the headers without
 *  reading any body, then extract a single entry on demand by re-scanning to it. libarchive
 *  is a forward-only reader that needs the whole archive in WASM memory (its constraint), but
 *  this avoids copying every entry's bytes onto the JS heap the way extractWithLibarchive does. */
export async function openLibarchiveStream(bytes: Uint8Array, fallbackName: string): Promise<ArchiveHandle> {
  const mod = await loadModule();
  const data = new Int8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

  const metas: { name: string; size: number; dir: boolean }[] = [];
  const reader = new ArchiveReader(mod, data);
  try {
    for (const entry of reader.entries()) {
      const name = entry.getPathname() || fallbackName;
      const dir = name.endsWith("/");
      metas.push({ name, size: dir ? 0 : entry.getSize(), dir });
    }
  } finally {
    reader.free();
  }

  return {
    entries: metas.map((m) => ({ name: m.name, size: m.size, dir: m.dir })),
    async read(name) {
      const r = new ArchiveReader(mod, data);
      try {
        for (const entry of r.entries()) {
          if ((entry.getPathname() || fallbackName) !== name) continue;
          if (name.endsWith("/")) return new Uint8Array(0);
          const raw = entry.readData();
          return raw ? new Uint8Array(raw) : new Uint8Array(0);
        }
        throw new Error(`libarchive: no entry ${name}`);
      } finally {
        r.free();
      }
    },
  };
}
