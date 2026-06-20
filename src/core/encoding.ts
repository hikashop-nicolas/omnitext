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

export function decodeBytes(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);

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

  const text = new TextDecoder("utf-8").decode(bytes);
  return { text, encoding: { label: "utf-8", bom: false }, lossyOnSave: false };
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
