import { describe, expect, it } from "vitest";
import { largestPreview } from "./raw-preview";

/** A minimal JPEG stream: SOI, SOFn with the size, SOS, some entropy data, EOI. */
function jpeg(sof: number, w: number, h: number, data: number[]): number[] {
  return [0xff, 0xd8, 0xff, sof, 0x00, 0x0b, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, ...data, 0xff, 0xd9];
}

describe("largestPreview", () => {
  it("picks the biggest decodable JPEG in the file", () => {
    const small = jpeg(0xc0, 160, 120, [1, 2, 3]);
    const big = jpeg(0xc0, 1920, 1280, [4, 0xff, 0x00, 5, 0xff, 0xd3, 6]);
    const file = Uint8Array.from([0x49, 0x49, 0x2a, 0, ...small, 9, 9, 9, ...big, 7, 7]);
    const out = largestPreview(file)!;
    expect(Array.from(out)).toEqual(big);
  });

  it("skips lossless JPEG, the sensor data a browser cannot show", () => {
    const preview = jpeg(0xc0, 160, 120, [1]);
    const sensor = jpeg(0xc3, 5472, 3648, [2, 3, 4]);
    const out = largestPreview(Uint8Array.from([...preview, ...sensor]))!;
    expect(Array.from(out)).toEqual(preview);
  });

  it("returns null when there is no JPEG", () => {
    expect(largestPreview(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 1, 2, 3]))).toBeNull();
    expect(largestPreview(new Uint8Array(64))).toBeNull();
  });
});
