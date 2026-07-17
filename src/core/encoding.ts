import type { TextEncoding } from "./types";

// Encoding + BOM handling. Line endings are NOT normalized here: they stay inside the
// canonical text so format models round-trip them byte-for-byte. UTF-8 is handled
// fully (with and without BOM). UTF-16 is decoded on read; re-encoding UTF-16 is a
// known v1 limitation (we re-encode as UTF-8, surfaced to the caller).

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  /** True if save cannot reproduce the original encoding byte-for-byte. */
  lossyOnSave: boolean;
}

/** UTF-16 BOM present: text despite the NUL bytes a binary sniffer would trip on. */
export function hasUtf16Bom(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2));
  return b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
}

/** Encodings offered by the "reopen with encoding" picker (TextDecoder built-ins). */
export const ENCODINGS = ["utf-8", "windows-1252", "iso-8859-15", "shift_jis", "euc-jp", "gbk", "big5", "windows-1251", "koi8-r"] as const;

/** Above this size, decoding the whole file into one JS string (roughly doubled in memory
    as UTF-16) and parsing it on the main thread risks freezing or OOM-ing the tab, so the
    open path routes the file to the read-only hex viewer instead. */
export const TEXT_DECODE_MAX_BYTES = 64 * 1024 * 1024;

export function exceedsTextDecodeLimit(byteLength: number): boolean {
  return byteLength > TEXT_DECODE_MAX_BYTES;
}

export type LineEnding = "lf" | "crlf" | "cr" | "mixed" | "none";

/** The dominant line ending in the bytes: LF (Unix), CRLF (Windows), CR (classic Mac),
    "mixed" when more than one style is present, or "none" when there are no line breaks.
    Scans a bounded prefix so a huge file does not stall the status bar. */
export function detectLineEnding(bytes: Uint8Array): LineEnding {
  const limit = Math.min(bytes.length, 1 << 20); // 1 MB is plenty to classify a text file
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < limit; i++) {
    const b = bytes[i]!;
    if (b === 0x0d) {
      if (bytes[i + 1] === 0x0a) {
        crlf++;
        i++; // consume the LF of this CRLF pair
      } else {
        cr++;
      }
    } else if (b === 0x0a) {
      lf++;
    }
  }
  const styles = (crlf > 0 ? 1 : 0) + (lf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
  if (styles === 0) return "none";
  if (styles > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (cr > 0) return "cr";
  return "lf";
}

export function decodeBytes(buffer: ArrayBuffer, forced?: string): DecodedText {
  const bytes = new Uint8Array(buffer);

  // An explicit pick from the encoding menu wins over detection.
  if (forced) {
    try {
      const text = new TextDecoder(forced).decode(bytes);
      return { text, encoding: { label: forced, bom: false }, lossyOnSave: forced !== "utf-8" };
    } catch {
      /* unknown codec: fall through to detection */
    }
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = new TextDecoder("utf-8").decode(bytes.subarray(3));
    return { text, encoding: { label: "utf-8", bom: true }, lossyOnSave: false };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
    return { text, encoding: { label: "utf-16le", bom: true }, lossyOnSave: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
    return { text, encoding: { label: "utf-16be", bom: true }, lossyOnSave: true };
  }

  // Strict UTF-8 first; anything invalid falls back to windows-1252 (which cannot
  // fail) instead of silently corrupting Latin-1/cp1252 text into U+FFFD.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: { label: "utf-8", bom: false }, lossyOnSave: false };
  } catch {
    const text = new TextDecoder("windows-1252").decode(bytes);
    return { text, encoding: { label: "windows-1252", bom: false }, lossyOnSave: true };
  }
}

export function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  const body = new TextEncoder().encode(text); // always UTF-8 in v1
  if (encoding.bom && encoding.label.startsWith("utf-8")) {
    const out = new Uint8Array(body.length + 3);
    out[0] = 0xef;
    out[1] = 0xbb;
    out[2] = 0xbf;
    out.set(body, 3);
    return out;
  }
  return body;
}
