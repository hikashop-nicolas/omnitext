import { gunzipSync, gzipSync, unzipSync, zipSync } from "fflate";
import { readTar, writeTar } from "./tar";

// Read/write archives across the formats we support fully client-side: zip (and zip-based
// .jar/.cbz) via fflate, and tar / tar.gz / .tgz via the tar codec (+ fflate gzip).
// 7z/rar/xz/zstd/bzip2 are out of scope (proprietary or heavy WASM, no permissive lib).

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
