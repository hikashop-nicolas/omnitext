import { describe, it, expect } from "vitest";
import { decodeBytes, encodeText, hasUtf16Bom } from "./encoding";

function bytesOf(...nums: number[]): ArrayBuffer {
  return new Uint8Array(nums).buffer;
}

describe("encoding", () => {
  it("decodes UTF-8 without BOM", () => {
    const d = decodeBytes(new TextEncoder().encode("hello").buffer as ArrayBuffer);
    expect(d.text).toBe("hello");
    expect(d.encoding).toEqual({ label: "utf-8", bom: false });
  });

  it("strips a UTF-8 BOM and records it", () => {
    const d = decodeBytes(bytesOf(0xef, 0xbb, 0xbf, 0x68, 0x69));
    expect(d.text).toBe("hi");
    expect(d.encoding).toEqual({ label: "utf-8", bom: true });
  });

  it("preserves CRLF line endings in the canonical text", () => {
    const d = decodeBytes(new TextEncoder().encode("a\r\nb").buffer as ArrayBuffer);
    expect(d.text).toBe("a\r\nb");
  });

  it("re-adds the BOM on encode so a BOM file round-trips byte-for-byte", () => {
    const original = bytesOf(0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63);
    const d = decodeBytes(original);
    const out = encodeText(d.text, d.encoding);
    expect([...out]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]);
  });

  it("does not add a BOM when the original had none", () => {
    const d = decodeBytes(new TextEncoder().encode("abc").buffer as ArrayBuffer);
    expect([...encodeText(d.text, d.encoding)]).toEqual([0x61, 0x62, 0x63]);
  });

  it("flags UTF-16 as lossy-on-save", () => {
    const d = decodeBytes(bytesOf(0xff, 0xfe, 0x61, 0x00));
    expect(d.text).toBe("a");
    expect(d.encoding.label).toBe("utf-16le");
    expect(d.lossyOnSave).toBe(true);
  });

  it("falls back to windows-1252 for invalid UTF-8 instead of corrupting", () => {
    const d = decodeBytes(bytesOf(0x63, 0x61, 0x66, 0xe9)); // "café" in Latin-1
    expect(d.text).toBe("caf\u00e9");
    expect(d.encoding.label).toBe("windows-1252");
    expect(d.lossyOnSave).toBe(true);
  });

  it("decodes with a forced encoding from the picker", () => {
    const d = decodeBytes(bytesOf(0x82, 0xa0), "shift_jis"); // hiragana A
    expect(d.text).toBe("\u3042");
    expect(d.encoding.label).toBe("shift_jis");
    expect(d.lossyOnSave).toBe(true);
    const u = decodeBytes(new TextEncoder().encode("plain").buffer as ArrayBuffer, "utf-8");
    expect(u.lossyOnSave).toBe(false);
  });

  it("detects UTF-16 BOMs so the binary sniffer does not eat them", () => {
    expect(hasUtf16Bom(bytesOf(0xff, 0xfe, 0x61, 0x00))).toBe(true); // LE
    expect(hasUtf16Bom(bytesOf(0xfe, 0xff, 0x00, 0x61))).toBe(true); // BE
    expect(hasUtf16Bom(bytesOf(0xef, 0xbb, 0xbf, 0x68))).toBe(false); // UTF-8 BOM
    expect(hasUtf16Bom(bytesOf(0x00, 0x01, 0x02))).toBe(false); // binary
    expect(hasUtf16Bom(bytesOf(0xff))).toBe(false); // too short
    expect(hasUtf16Bom(bytesOf())).toBe(false); // empty
  });
});
