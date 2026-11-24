import { describe, expect, it } from "vitest";
import { OFFICE_PICTURES, PDF_PICTURES, pictureFor, sniffPicture } from "./picture-convert";

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const ftyp = (brand: string): Uint8Array => bytes([0, 0, 0, 24], "ftyp", brand, [0, 0, 0, 0], "mif1", brand);

describe("sniffPicture", () => {
  it("tells the formats apart by their first bytes", () => {
    expect(sniffPicture(bytes([0x89], "PNG\r\n"))).toBe("png");
    expect(sniffPicture(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffPicture(bytes("GIF89a"))).toBe("gif");
    expect(sniffPicture(bytes("BM", [0, 0]))).toBe("bmp");
    expect(sniffPicture(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("webp");
    expect(sniffPicture(bytes("II", [0x2a, 0]))).toBe("tiff");
    expect(sniffPicture(bytes("8BPS"))).toBe("psd");
    expect(sniffPicture(bytes([0xff, 0x0a]))).toBe("jxl");
    expect(sniffPicture(ftyp("heic"))).toBe("heic");
    expect(sniffPicture(ftyp("avif"))).toBe("avif");
    expect(sniffPicture(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
    expect(sniffPicture(bytes("hello"))).toBe("unknown");
  });

  it("names camera RAW by extension, since it is TIFF inside", () => {
    expect(sniffPicture(bytes("II", [0x2a, 0]), "IMG_0001.CR2")).toBe("raw");
    expect(sniffPicture(bytes("II", [0x2a, 0]), "scan.tif")).toBe("tiff");
  });
});

describe("pictureFor", () => {
  it("passes a picture the target keeps through untouched", async () => {
    const png = bytes([0x89], "PNG\r\n", [0x1a, 0x0a]);
    const out = await pictureFor("logo.png", png, OFFICE_PICTURES);
    expect(out).toEqual({ name: "logo.png", bytes: png, mime: "image/png" });
    const tif = bytes("MM", [0, 0x2a]);
    expect((await pictureFor("scan.tiff", tif, PDF_PICTURES)).bytes).toBe(tif);
  });
});
