import { describe, expect, it } from "vitest";
import { detectArchiveKind, readArchive, readArchiveAsync, writeArchive, writeArchiveAsync, type ArchiveEntry } from "./archive";
import { readTar, writeTar } from "./tar";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const ENTRIES: ArchiveEntry[] = [
  { name: "hello.txt", data: enc("hi there\n") },
  { name: "dir/data.json", data: enc('{"a":1}') },
];

describe("tar codec", () => {
  it("round-trips files (incl. a path with a directory)", () => {
    const out = readTar(writeTar(ENTRIES));
    expect(out.map((e) => e.name).sort()).toEqual(["dir/data.json", "hello.txt"]);
    expect(dec(out.find((e) => e.name === "hello.txt")!.data)).toBe("hi there\n");
    expect(dec(out.find((e) => e.name === "dir/data.json")!.data)).toBe('{"a":1}');
  });
});

describe("archive codec", () => {
  for (const kind of ["zip", "tar", "tgz"] as const) {
    it(`detects and round-trips ${kind}`, () => {
      const packed = writeArchive(kind, ENTRIES);
      expect(detectArchiveKind(packed)).toBe(kind);
      const out = readArchive(packed).filter((e) => !e.name.endsWith("/"));
      expect(out.map((e) => e.name).sort()).toEqual(["dir/data.json", "hello.txt"]);
      expect(dec(out.find((e) => e.name === "hello.txt")!.data)).toBe("hi there\n");
    });

    it(`off-thread (async) round-trips ${kind} identically to sync`, async () => {
      const packed = await writeArchiveAsync(kind, ENTRIES);
      expect(Array.from(packed)).toEqual(Array.from(writeArchive(kind, ENTRIES)));
      // Same input, same bytes, whenever it runs: gzip would otherwise stamp the current time into
      // its header and this comparison would fail whenever the two packs straddled a second.
      expect(Array.from(await writeArchiveAsync(kind, ENTRIES))).toEqual(Array.from(packed));
      const out = (await readArchiveAsync(packed)).filter((e) => !e.name.endsWith("/"));
      expect(out.map((e) => e.name).sort()).toEqual(["dir/data.json", "hello.txt"]);
      expect(dec(out.find((e) => e.name === "dir/data.json")!.data)).toBe('{"a":1}');
    });
  }
});

// A 7z or a RAR is readable but not writable here. detectArchiveKind used to answer "tar"
// for anything it did not recognise, and reading a 7z as a tar yields no entries and no
// error, so a save-back rebuilt the archive as a tar holding only the edited file and wrote
// it over the original. Null is what stops that, so it is worth pinning down.
describe("which archives can be written back", () => {
  const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);

  it("recognises the three kinds it can write", () => {
    expect(detectArchiveKind(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("zip");
    expect(detectArchiveKind(bytes(0x1f, 0x8b, 0x08, 0x00))).toBe("tgz");
    const tar = new Uint8Array(512);
    tar.set([0x75, 0x73, 0x74, 0x61, 0x72], 257); // "ustar"
    expect(detectArchiveKind(tar)).toBe("tar");
  });

  it("refuses to name a kind for archives it can only read", () => {
    expect(detectArchiveKind(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c))).toBeNull(); // 7z
    expect(detectArchiveKind(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00))).toBeNull(); // RAR
    expect(detectArchiveKind(bytes(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00))).toBeNull(); // xz
    expect(detectArchiveKind(bytes(0x42, 0x5a, 0x68, 0x39))).toBeNull(); // bzip2
  });

  it("refuses on something that is not an archive at all", () => {
    expect(detectArchiveKind(new TextEncoder().encode("hello, not an archive"))).toBeNull();
    expect(detectArchiveKind(new Uint8Array(0))).toBeNull();
  });
});
