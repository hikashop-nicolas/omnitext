import { gunzipSync, gzipSync, unzipSync, zipSync } from "fflate";
import { readTar, writeTar } from "./tar";
import { gunzipAsync, gzipAsync, unzipAsync, zipAsync } from "./zip";

// Read/write archives across the formats we support fully client-side: zip (and zip-based
// .jar/.cbz) via fflate, tar / tar.gz / .tgz via the tar codec (+ fflate gzip), and 7z by
// reading with libarchive and writing with 7-Zip itself (core/sevenzip.ts). Both of those
// load only when a 7z turns up, so the zip and tar paths carry none of it.
//
// RAR, xz and bzip2 stay extract-only: no free RAR compressor exists, and the other two are
// single-file streams rather than archives to write back into.

export type ArchiveKind = "zip" | "tar" | "tgz" | "7z";

/**
 * gzip stamps the current time into its header unless told otherwise, which makes the same input
 * produce different bytes from one second to the next. Zero means "no timestamp" per the gzip
 * spec, so a .tgz written from the same entries is always byte-identical.
 */
export const GZIP_OPTS = { mtime: 0 } as const;

export interface ArchiveEntry {
  name: string;
  data: Uint8Array;
}

const isZip = (b: Uint8Array): boolean => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
// tar has no magic at the start; its "ustar" marker sits inside the first header block.
const isTar = (b: Uint8Array): boolean =>
  b.length >= 262 && b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74 && b[260] === 0x61 && b[261] === 0x72;
const isSevenZip = (b: Uint8Array): boolean =>
  b.length >= 6 && [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c].every((x, i) => b[i] === x);

/**
 * Which of the writable kinds these bytes are, or null for anything else.
 *
 * Null matters. This used to answer "tar" for whatever it did not recognise, and a 7z or a
 * RAR reads as zero tar entries without complaining, so saving a file edited from inside one
 * rebuilt it as a tar holding only that file and wrote it over the original. Everything else
 * in the archive was gone. Callers must handle null rather than write something.
 */
export function detectArchiveKind(bytes: Uint8Array): ArchiveKind | null {
  if (isZip(bytes)) return "zip";
  if (isGzip(bytes)) return "tgz";
  if (isSevenZip(bytes)) return "7z";
  if (isTar(bytes)) return "tar";
  return null;
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
  return kind === "tgz" ? gzipSync(tar, GZIP_OPTS) : tar;
}

// Same as readArchive / writeArchive, but the zip/gzip runs off the main thread. Used on the
// save/re-pack path (and archive open) so a large archive does not freeze the UI. The tar
// framing itself is light and stays synchronous; only the deflate/inflate is offloaded.
export async function readArchiveAsync(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  if (isZip(bytes)) return Object.entries(await unzipAsync(bytes)).map(([name, data]) => ({ name, data }));
  if (isGzip(bytes)) return readTar(await gunzipAsync(bytes));
  // 7z needs libarchive, imported here so the zip and tar paths never pull in the wasm.
  if (isSevenZip(bytes)) {
    const { extractWithLibarchive } = await import("./libarchive");
    return extractWithLibarchive(bytes, "archive");
  }
  return readTar(bytes);
}

export async function writeArchiveAsync(kind: ArchiveKind, entries: ArchiveEntry[]): Promise<Uint8Array> {
  if (kind === "zip") {
    const files: Record<string, Uint8Array> = {};
    for (const e of entries) files[e.name] = new Uint8Array(e.data);
    return zipAsync(files);
  }
  if (kind === "7z") {
    // 7-Zip's own encoder, a chunk of its own, fetched the first time a 7z is saved.
    const { writeSevenZip } = await import("./sevenzip");
    return writeSevenZip(entries);
  }
  const tar = writeTar(entries.map((e) => ({ name: e.name, data: new Uint8Array(e.data) })));
  return kind === "tgz" ? gzipAsync(tar) : tar;
}
