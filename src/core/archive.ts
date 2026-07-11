import { gunzipSync, gzipSync, unzipSync, zipSync } from "fflate";
import { readTar, writeTar } from "./tar";
import { gunzipAsync, gzipAsync, unzipAsync, zipAsync } from "./zip";

// Read/write archives across the formats we support fully client-side: zip (and zip-based
// .jar/.cbz) via fflate, and tar / tar.gz / .tgz via the tar codec (+ fflate gzip). These
// are the read/write formats. 7z/RAR/xz/bzip2/zstd/lz4 are extract-only, handled separately
// by core/libarchive.ts (libarchive-wasm) and surfaced through the archive viewer.

export type ArchiveKind = "zip" | "tar" | "tgz";

export interface ArchiveEntry {
  name: string;
  data: Uint8Array;
}

const isZip = (b: Uint8Array): boolean => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Identify an archive's kind from its bytes (zip magic, gzip magic = tgz, else tar). */
export function detectArchiveKind(bytes: Uint8Array): ArchiveKind {
  if (isZip(bytes)) return "zip";
  if (isGzip(bytes)) return "tgz";
  return "tar";
}

/** List an archive's entries (zip, tar, or gzip-wrapped tar). */
export function readArchive(bytes: Uint8Array): ArchiveEntry[] {
  if (isZip(bytes)) return Object.entries(unzipSync(bytes)).map(([name, data]) => ({ name, data }));
  if (isGzip(bytes)) return readTar(gunzipSync(bytes));
  return readTar(bytes);
}

/** Rebuild an archive of the given kind from entries. */
export function writeArchive(kind: ArchiveKind, entries: ArchiveEntry[]): Uint8Array {
  if (kind === "zip") {
    const files: Record<string, Uint8Array> = {};
    for (const e of entries) files[e.name] = new Uint8Array(e.data);
    return zipSync(files);
  }
  const tar = writeTar(entries.map((e) => ({ name: e.name, data: new Uint8Array(e.data) })));
  return kind === "tgz" ? gzipSync(tar) : tar;
}

// Same as readArchive / writeArchive, but the zip/gzip runs off the main thread. Used on the
// save/re-pack path (and archive open) so a large archive does not freeze the UI. The tar
// framing itself is light and stays synchronous; only the deflate/inflate is offloaded.
export async function readArchiveAsync(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  if (isZip(bytes)) return Object.entries(await unzipAsync(bytes)).map(([name, data]) => ({ name, data }));
  if (isGzip(bytes)) return readTar(await gunzipAsync(bytes));
  return readTar(bytes);
}

export async function writeArchiveAsync(kind: ArchiveKind, entries: ArchiveEntry[]): Promise<Uint8Array> {
  if (kind === "zip") {
    const files: Record<string, Uint8Array> = {};
    for (const e of entries) files[e.name] = new Uint8Array(e.data);
    return zipAsync(files);
  }
  const tar = writeTar(entries.map((e) => ({ name: e.name, data: new Uint8Array(e.data) })));
  return kind === "tgz" ? gzipAsync(tar) : tar;
}
