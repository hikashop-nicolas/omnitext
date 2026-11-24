// Turns a picture the user picked into one the target editor can keep. Each editor stores
// only some formats (a PDF engine, Word, Excel); any other picture Omnitext can open
// (WebP, HEIC, AVIF, TIFF, PSD, camera RAW, JPEG XL...) is redrawn as PNG, or as JPEG
// when it is a photo without transparency, so a phone's photos can be added anywhere.

export type PictureKind =
  | "png" | "jpeg" | "gif" | "bmp" | "webp" | "tiff" | "jp2" | "pcx" | "heic" | "avif"
  | "psd" | "raw" | "jxl" | "ico" | "svg" | "unknown";

/** What a PDF page can take as a picture (PdfCraft's image import). */
export const PDF_PICTURES: readonly PictureKind[] = ["png", "jpeg", "jp2", "tiff", "gif", "bmp", "pcx"];
/** What Word, Excel, PowerPoint and LibreOffice all show, old versions included. */
export const OFFICE_PICTURES: readonly PictureKind[] = ["png", "jpeg", "gif", "bmp"];

export interface Picture {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

const RAW_EXTS = /\.(cr2|cr3|nef|nrw|arw|sr2|srf|dng|rw2|orf|raf|pef|srw|rwl|3fr|erf|mrw)$/i;

const MIME: Record<PictureKind, string> = {
  png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp",
  tiff: "image/tiff", jp2: "image/jp2", pcx: "image/x-pcx", heic: "image/heic", avif: "image/avif",
  psd: "image/vnd.adobe.photoshop", raw: "image/x-dcraw", jxl: "image/jxl", ico: "image/x-icon",
  svg: "image/svg+xml", unknown: "application/octet-stream",
};

const starts = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));

/** The picture's format from its first bytes (RAW, being TIFF inside, from its name). */
export function sniffPicture(bytes: Uint8Array, name = ""): PictureKind {
  if (RAW_EXTS.test(name)) return "raw";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(bytes, 0, 4) === "GIF8") return "gif";
  if (ascii(bytes, 0, 2) === "BM") return "bmp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (starts(bytes, [0x49, 0x49, 0x2a, 0x00]) || starts(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (starts(bytes, [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20]) || starts(bytes, [0xff, 0x4f, 0xff, 0x51])) return "jp2";
  if (starts(bytes, [0xff, 0x0a]) || starts(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return "jxl";
  if (ascii(bytes, 0, 4) === "8BPS") return "psd";
  if (starts(bytes, [0x00, 0x00, 0x01, 0x00])) return "ico";
  if (bytes[0] === 0x0a && bytes[2] === 0x01 && bytes.length > 128) return "pcx";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length, 40));
    if (/avi[fs]/.test(brands)) return "avif";
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) return "heic";
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head) || /^<svg[\s>]/i.test(head)) return "svg";
  return "unknown";
}

type Pixels = { width: number; height: number; data: Uint8ClampedArray };

async function viaBrowser(bytes: Uint8Array, mime: string): Promise<Pixels> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 300;
    const h = img.naturalHeight || 150;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, w, h);
    return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function heic(bytes: Uint8Array): Promise<Pixels> {
  const lib = (await import("libheif-js/wasm-bundle")).default as unknown as {
    HeifDecoder: new () => { decode(b: Uint8Array): { get_width(): number; get_height(): number; display(d: ImageData, cb: (d: ImageData | null) => void): void }[] };
  };
  const [image] = new lib.HeifDecoder().decode(bytes);
  if (!image) throw new Error("no picture in this HEIC file");
  const out = new ImageData(image.get_width(), image.get_height());
  await new Promise<void>((resolve, reject) => image.display(out, (d) => (d ? resolve() : reject(new Error("HEIC decode failed")))));
  return { width: out.width, height: out.height, data: out.data };
}

async function tiff(bytes: Uint8Array): Promise<Pixels> {
  const UTIF = (await import("utif")).default;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  for (const ifd of UTIF.decode(buf)) {
    try {
      UTIF.decodeImage(buf, ifd);
    } catch {
      continue; // an EXIF or thumbnail directory
    }
    const width = Number(ifd.width), height = Number(ifd.height);
    if (width > 0 && height > 0) return { width, height, data: new Uint8ClampedArray(UTIF.toRGBA8(ifd)) };
  }
  throw new Error("no picture in this TIFF file");
}

async function psd(bytes: Uint8Array): Promise<Pixels> {
  const Psd = (await import("@webtoon/psd")).default;
  const file = Psd.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { width: file.width, height: file.height, data: new Uint8ClampedArray(await file.composite()) };
}

const hasAlpha = (p: Pixels): boolean => {
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 255) return true;
  return false;
};

/** Photos (lossy sources) without transparency become JPEG; anything else PNG. */
async function encode(p: Pixels, photo: boolean): Promise<{ bytes: Uint8Array; kind: "png" | "jpeg" }> {
  const kind = photo && !hasAlpha(p) ? "jpeg" : "png";
  const c = document.createElement("canvas");
  c.width = p.width;
  c.height = p.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, MIME[kind], 0.92));
  if (!blob) throw new Error("the picture could not be converted");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind };
}

const rename = (name: string, kind: "png" | "jpeg"): string => `${name.replace(/\.[^./\\]*$/, "") || "picture"}.${kind === "jpeg" ? "jpg" : "png"}`;

/**
 * The picture as the target can keep it: unchanged when its format is in `accepted`, else
 * converted. Throws when Omnitext cannot read the picture at all.
 */
export async function pictureFor(name: string, bytes: Uint8Array, accepted: readonly PictureKind[]): Promise<Picture> {
  const kind = sniffPicture(bytes, name);
  if (accepted.includes(kind)) return { name, bytes, mime: MIME[kind] };
  if (kind === "raw") {
    const { largestPreview } = await import("../editors/raw-preview");
    const preview = largestPreview(bytes);
    if (!preview) throw new Error("this RAW file has no preview picture");
    if (accepted.includes("jpeg")) return { name: rename(name, "jpeg"), bytes: preview, mime: MIME.jpeg };
    return pictureFor(rename(name, "jpeg"), preview, accepted);
  }
  const pixels =
    kind === "heic" ? await heic(bytes)
    : kind === "tiff" ? await tiff(bytes)
    : kind === "psd" ? await psd(bytes)
    : await viaBrowser(bytes, MIME[kind]); // WebP, AVIF, JPEG XL, ICO, SVG, and what the browser knows
  const lossyWebp = kind === "webp" && ascii(bytes, 12, 16) !== "VP8L";
  const out = await encode(pixels, kind === "heic" || kind === "avif" || kind === "jxl" || kind === "jpeg" || lossyWebp);
  return { name: rename(name, out.kind), bytes: out.bytes, mime: MIME[out.kind] };
}

/** `pictureFor` for a picked File. */
export async function pictureFromFile(file: File, accepted: readonly PictureKind[]): Promise<Picture> {
  return pictureFor(file.name, new Uint8Array(await file.arrayBuffer()), accepted);
}
