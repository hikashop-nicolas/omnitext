// @vitest-environment happy-dom
/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { FormatRegistry } from "./registries";
import type { FormatDescriptor } from "./types";
import { contentFormatFor, sniffFormat, sniffHead } from "./sniff";
import { makeTextFormats } from "../formats/codemirror-formats";
import { makeViewerFormats, makeGenericViewerFormats } from "../formats/binary-viewers";
import { blankTemplate } from "../formats/blank-templates";
import { perfettoBytes as sampleTrace } from "../formats/trace-samples.fixture";

// Every format the app registers, so a sniffed id is checked against the real set (issue #53).
const modules = import.meta.glob<Record<string, unknown>>(["../formats/*.ts", "!../formats/*.test.ts", "!../formats/*.impl.ts"], { eager: true });
function allFormats(): FormatRegistry {
  const reg = new FormatRegistry();
  const seen = new Set<string>();
  const add = (f: FormatDescriptor) => {
    if (seen.has(f.manifest.id)) return;
    seen.add(f.manifest.id);
    reg.register(f);
  };
  for (const mod of Object.values(modules)) {
    for (const v of Object.values(mod)) {
      const f = v as FormatDescriptor;
      if (f && typeof f === "object" && f.manifest?.kind === "format" && typeof f.detect === "function") add(f);
    }
  }
  for (const f of [...makeTextFormats(), ...makeViewerFormats(), ...makeGenericViewerFormats()]) add(f);
  return reg;
}
const formats = allFormats();
const opened = (bytes: Uint8Array, name: string) => contentFormatFor(bytes, name, formats)?.manifest.id ?? null;
const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe("content sniffing (issue #53)", () => {
  it("opens a PDF renamed .bin as a PDF", async () => {
    const pdf = await blankTemplate("pdf");
    expect(opened(pdf!, "download.bin")).toBe("pdf");
    expect(opened(bytesOf("junk\n%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj"), "download")).toBe("pdf");
  });

  it("opens office documents renamed .bin by their zip content", async () => {
    for (const id of ["docx", "xlsx", "odt", "ods"]) {
      expect(opened((await blankTemplate(id))!, "file.bin")).toBe(id);
    }
    const pptx = zipSync({ "[Content_Types].xml": strToU8('<Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>') });
    expect(opened(pptx, "slides.bin")).toBe("pptx");
    const epub = zipSync({ mimetype: strToU8("application/epub+zip"), "META-INF/container.xml": strToU8("<container/>") });
    expect(opened(epub, "book")).toBe("epub");
    expect(opened(zipSync({ "a.txt": strToU8("hi") }), "bundle.bin")).toBe("zip");
  }, 30000);

  it("opens a PNG with no extension in the image viewer", () => {
    expect(opened(PNG, "picture")).toBe("png");
    expect(opened(bytesOf("\xff\xd8\xff\xe0\0\x10JFIF"), "photo.bin")).toBe("jpeg");
    expect(opened(bytesOf("GIF89a\x01\0\x01\0"), "anim")).toBe("gif");
    expect(opened(bytesOf("RIFF\0\0\0\0WEBPVP8 "), "x.bin")).toBe("webp");
  });

  it("leaves random bytes and plain text to the old routing", () => {
    const random = new Uint8Array(4096);
    let x = 12345;
    for (let i = 0; i < random.length; i++) random[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
    random[0] = 0x13;
    expect(opened(random, "firmware.bin")).toBe(null);
    expect(opened(bytesOf("hello world\n"), "notes.bin")).toBe(null);
    // A text file that talks about PDFs keeps its extension's format.
    expect(opened(bytesOf("The header is %PDF-1.7 then objects.\n"), "notes.md")).toBe(null);
  });

  it("opens a Perfetto trace with no extension by its synchronization marker (issue #69)", () => {
    expect(opened(sampleTrace(), "trace")).toBe("perfetto");
    expect(opened(sampleTrace(), "record.bin")).toBe("perfetto");
    // Protobuf that is not a trace: field-1 records without the marker.
    expect(opened(Uint8Array.from([0x0a, 3, 0x08, 1, 0x10, 0x0a, 2, 0x08, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "x.bin")).toBe(null);
  });

  it("trusts a known extension unless the bytes are binary", () => {
    expect(opened(bytesOf("{\\rtf1 but saved as text}"), "notes.txt")).toBe(null);
    expect(opened(PNG, "wrong.txt")).toBe("png");
  });

  it("only names formats the app registers", () => {
    const samples = [
      PNG, bytesOf("ID3\x04"), bytesOf("OggS\0"), bytesOf("fLaC\0"), bytesOf("MThd\0\0\0\x06"),
      bytesOf("SQLite format 3\0"), bytesOf("PAR1\0"), bytesOf("ARROW1\0\0"), bytesOf("8BPS\0\x01"),
      bytesOf("II*\0\x08\0"), bytesOf("\0\0\0\x18ftypheic"), bytesOf("\0\0\0\x18ftypavif"), bytesOf("\0\0\0\x18ftypisom"),
      bytesOf("\x1a\x45\xdf\xa3webm"), bytesOf("7z\xbc\xaf\x27\x1c\0"), bytesOf("Rar!\x1a\x07"), bytesOf("BZh91AY"),
      bytesOf("{\\rtf1\\ansi"), bytesOf("AC1032\0"), bytesOf("glTF\x02\0\0\0"), bytesOf("wOFF\0\x01"),
      bytesOf("d8:announce35:"), bytesOf("RIFF\0\0\0\0WAVEfmt "),
    ];
    for (const s of samples) {
      const id = sniffHead(s);
      expect(id, String.fromCharCode(...s.subarray(0, 8))).not.toBe(null);
      expect(formats.byId(id!)?.manifest.binary, id!).toBe(true);
    }
    for (const id of ["docx", "xlsx", "pptx", "odt", "ods", "epub", "mxl", "pkpass", "mscz", "kmz", "jar", "zip"]) {
      expect(formats.byId(id)?.manifest.binary, id).toBe(true);
    }
    expect(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe("zip"); // truncated zip
  });
});
