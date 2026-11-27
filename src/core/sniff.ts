// Content sniffing for files whose name or MIME type says nothing useful (.bin, no extension,
// application/octet-stream). Returns a registered format id, or null to keep today's routing.
import { unzipSync } from "fflate";
import { looksBinary } from "./encoding";
import { ctraceStart, isFxt } from "../formats/trace-detect";
import { sniffProfileBytes } from "./sniff-profile";
import type { FormatDescriptor, FormatRegistryReadonly } from "./types";

const ascii = (b: Uint8Array, from: number, len: number): string =>
  String.fromCharCode(...b.subarray(from, Math.min(b.length, from + len)));

const starts = (b: Uint8Array, sig: number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** Format id recognised from the first bytes alone (no zip inspection). */
export function sniffHead(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  const s4 = ascii(b, 0, 4);
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (/^GIF8[79]a/.test(ascii(b, 0, 6))) return "gif";
  if (s4 === "RIFF") {
    const kind = ascii(b, 8, 4);
    if (kind === "WEBP") return "webp";
    if (kind === "WAVE") return "wav";
    if (kind === "AVI ") return "avi";
  }
  if (starts(b, [0xff, 0x0a]) || starts(b, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return "jxl";
  if (ascii(b, 4, 4) === "ftyp") return ftyp(ascii(b, 8, 4));
  if (s4 === "II*\0" || s4 === "MM\0*") return "tiff";
  if (s4 === "8BPS") return "psd";
  if (ascii(b, 0, 2) === "BM" && b.length >= 10 && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0) return "bmp";
  if (starts(b, [0, 0, 1, 0]) && b.length >= 10 && b[4]! > 0 && b[9] === 0) return "icon";
  if (s4 === "OggS") return "oga";
  if (s4 === "fLaC") return "flac";
  if (ascii(b, 0, 3) === "ID3") return "mp3";
  if (s4 === "MThd") return "midi";
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(b, 0, 64).includes("webm") ? "webmv" : "mkv";
  if (starts(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return "wmv";
  if (ascii(b, 0, 16) === "SQLite format 3\0") return "sqlite";
  if (s4 === "PAR1") return "parquet";
  if (ascii(b, 0, 6) === "ARROW1") return "arrow";
  if (ascii(b, 128, 4) === "DICM") return "dicom";
  if (ascii(b, 60, 8) === "BOOKMOBI") return "ebook";
  if (ascii(b, 0, 5) === "{\\rtf") return "rtf";
  if (/^AC10\d\d/.test(ascii(b, 0, 6))) return "dwg";
  if (s4 === "glTF") return "model3d";
  if (starts(b, [0, 0, 0x27, 0x0a]) && starts(b, [0xe8, 0x03, 0, 0], 28)) return "shp";
  if (s4 === "OTTO" || s4 === "true" || s4 === "wOFF" || starts(b, [0, 1, 0, 0, 0])) return "font";
  if (/^d\d+:(announce|info|created|comment|url-list)/.test(ascii(b, 0, 24))) return "torrent";
  if (starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (ascii(b, 0, 4) === "Rar!") return "rar";
  if (starts(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0])) return "xz";
  if (/^BZh[1-9]/.test(ascii(b, 0, 4))) return "bzip2";
  if (ascii(b, 257, 5) === "ustar") return "tar";
  if (isFxt(b)) return "fuchsia";
  if (ctraceStart(b) >= 0) return "ctrace";
  if (looksLikePerfetto(b)) return "perfetto";
  const profile = sniffProfileBytes(b);
  if (profile) return profile;
  // PDF readers accept junk before the header, up to 1 KiB.
  if (/%PDF-\d\.\d/.test(ascii(b, 0, 1024))) return "pdf";
  return null;
}

// Perfetto traces (protobuf) have no magic number of their own.
const SYNC_MARKER = [0x82, 0x47, 0x7a, 0x76, 0xb2, 0x8d, 0x42, 0xba, 0x81, 0xdc, 0x33, 0x32, 0x6d, 0x57, 0xa0, 0x79];

function pbVarint(b: Uint8Array, at: number): [number, number] | null {
  let v = 0;
  let mul = 1;
  for (let i = at; i < b.length && i < at + 10; i++) {
    v += (b[i]! & 0x7f) * mul;
    if (b[i]! < 0x80) return [v, i + 1];
    mul *= 128;
  }
  return null;
}

/**
 * Whether b[start, end) is a whole protobuf message; `stamped` when it has what only a TracePacket
 * carries: a varint trusted uid (3), timestamp (8) or sequence id (10), or compressed packets.
 */
function pbMessage(b: Uint8Array, start: number, end: number): { stamped: boolean } | null {
  let pos = start;
  let stamped = false;
  while (pos < end) {
    const tag = pbVarint(b, pos);
    if (!tag || tag[0] < 8) return null;
    const field = Math.floor(tag[0] / 8);
    const wt = tag[0] % 8;
    pos = tag[1];
    if (wt === 0) {
      const v = pbVarint(b, pos);
      if (!v) return null;
      if (field === 3 || field === 8 || field === 10) stamped = true;
      pos = v[1];
    } else if (wt === 1) pos += 8;
    else if (wt === 5) pos += 4;
    else if (wt === 2) {
      const n = pbVarint(b, pos);
      if (!n) return null;
      if (field === 50 || field === 133) stamped = true;
      pos = n[1] + n[0];
    } else return null;
  }
  return pos === end ? { stamped } : null;
}

/**
 * Whether these first bytes are a Perfetto trace: a run of well-formed field-1 packets, one of
 * which holds the synchronization marker the tracing service writes near the start of a trace.
 * Older and synthetic traces have no marker: then every whole packet must be a valid message,
 * at least three of them stamped as TracePackets are (or every one, when `b` is the whole file).
 */
export function looksLikePerfetto(b: Uint8Array, whole = false): boolean {
  if (b.length < 21 || b[0] !== 0x0a) return false;
  let pos = 0;
  let stamped = 0;
  let count = 0;
  while (pos < b.length) {
    if (b[pos] !== 0x0a) return false;
    const len = pbVarint(b, pos + 1);
    if (!len) return false;
    const [n, start] = len;
    const end = Math.min(b.length, start + n);
    // The marker is field 36 (tag a2 02), 16 bytes long (10).
    for (let i = start; i + 19 <= end; i++) {
      if (b[i] === 0xa2 && b[i + 1] === 0x02 && b[i + 2] === 0x10 && SYNC_MARKER.every((v, k) => b[i + 3 + k] === v)) return true;
    }
    if (start + n <= b.length) {
      const msg = pbMessage(b, start, start + n);
      if (!msg) return false;
      count++;
      if (msg.stamped) stamped++;
    } else whole = false;
    pos = start + n;
  }
  return count >= 3 ? stamped >= 3 : whole && count > 0 && stamped === count;
}

/** How far into a file to look for marker-less Perfetto packets, which can be large. */
const PERFETTO_SCAN = 2 << 20;

// ISO base media brands (HEIF images, MP4/MOV/3GP video, M4A audio).
function ftyp(brand: string): string | null {
  if (brand === "avif" || brand === "avis") return "avif";
  if (["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
  if (brand === "qt  ") return "mov";
  if (brand.startsWith("3g")) return "3gp";
  if (brand === "M4A " || brand === "M4B ") return "m4a";
  return "mp4";
}

const ZIP_MIMETYPES: Record<string, string> = {
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/epub+zip": "epub",
  "application/vnd.recordare.musicxml": "mxl",
};

/** Which zip-based format a zip is, from its entry names; only tiny entries are inflated. */
export function sniffZip(bytes: Uint8Array): string {
  const names: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return (f.name === "mimetype" || f.name === "[Content_Types].xml") && f.originalSize < 1 << 20;
      },
    });
  } catch {
    return "zip";
  }
  const dec = (n: string) => (files[n] ? new TextDecoder().decode(files[n]) : "");
  const mimetype = dec("mimetype").trim();
  if (ZIP_MIMETYPES[mimetype]) return ZIP_MIMETYPES[mimetype];
  const types = dec("[Content_Types].xml");
  if (types) {
    if (/wordprocessingml\.(document|template)\.main|ms-word\.(document|template)\.macroEnabled/.test(types)) return "docx";
    if (/spreadsheetml\.(sheet|template)\.main|ms-excel\.(sheet|template)\.macroEnabled/.test(types)) return "xlsx";
    if (/presentationml\.(presentation|slideshow|template)\.main|ms-powerpoint\.(presentation|slideshow|template)\.macroEnabled/.test(types)) return "pptx";
  }
  if (names.includes("pass.json") && names.includes("manifest.json")) return "pkpass";
  if (names.some((n) => /^[^/]+\.mscx$/i.test(n))) return "mscz";
  if (names.some((n) => /^[^/]+\.kml$/i.test(n))) return "kmz";
  if (names.includes("META-INF/MANIFEST.MF")) return "jar";
  return "zip";
}

/** Format id from the content: magic number on the head, then zip entries when it starts with PK. */
export function sniffFormat(bytes: Uint8Array): string | null {
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) || starts(bytes, [0x50, 0x4b, 0x05, 0x06])) return sniffZip(bytes);
  return sniffHead(bytes.subarray(0, 4096)) ?? (looksLikePerfetto(bytes.subarray(0, PERFETTO_SCAN), bytes.length <= PERFETTO_SCAN) ? "perfetto" : null);
}

/** The binary format to open by content: only when the extension is unknown or binary bytes sit behind a text one. */
export function contentFormatFor(bytes: Uint8Array, filename: string, formats: FormatRegistryReadonly): FormatDescriptor | null {
  const dot = filename.lastIndexOf(".");
  const knownExt = dot >= 0 && formats.byExtension(filename.slice(dot)).length > 0;
  if (knownExt && !looksBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + Math.min(bytes.byteLength, 8192)) as ArrayBuffer)) return null;
  const id = sniffFormat(bytes);
  const d = id ? formats.byId(id) : undefined;
  return d?.manifest.binary ? d : null;
}
