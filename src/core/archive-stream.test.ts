import { gzipSync, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { openArchiveStream } from "./archive-stream";
import { writeTar } from "./tar";

const enc = (s: string) => new TextEncoder().encode(s);

describe("openArchiveStream: zip", () => {
  it("lists entries from the central directory without decompressing bodies", async () => {
    const zip = zipSync({
      "readme.txt": enc("hello"),
      "src/main.js": enc("console.log(1)\n".repeat(50)), // large enough to deflate
      "empty.dat": new Uint8Array(0),
    });
    const handle = await openArchiveStream(new Blob([zip as BlobPart]));
    expect(handle).not.toBeNull();
    const names = handle!.entries.map((e) => e.name).sort();
    expect(names).toEqual(["empty.dat", "readme.txt", "src/main.js"]);
    // Sizes are the UNCOMPRESSED sizes, read from the header (no body was inflated to list).
    const bySize = Object.fromEntries(handle!.entries.map((e) => [e.name, e.size]));
    expect(bySize["readme.txt"]).toBe(5);
    expect(bySize["src/main.js"]).toBe("console.log(1)\n".length * 50);
  });

  it("reads a single stored entry byte-for-byte", async () => {
    const body = enc("stored, not compressed");
    const zip = zipSync({ "a.bin": [body, { level: 0 }] }); // level 0 = stored
    const handle = await openArchiveStream(new Blob([zip as BlobPart]));
    expect([...(await handle!.read("a.bin"))]).toEqual([...body]);
  });

  it("reads and inflates a single deflated entry, matching a full unzip", async () => {
    const files: Record<string, Uint8Array> = {
      "a.txt": enc("A".repeat(1000)),
      "b/c.txt": enc("line\n".repeat(500)),
      "d.txt": enc("mixed content 123 éè"),
    };
    const zip = zipSync(files);
    const blob = new Blob([zip as BlobPart]);
    const handle = await openArchiveStream(blob);
    const reference = unzipSync(zip);
    for (const name of Object.keys(files)) {
      expect([...(await handle!.read(name))]).toEqual([...reference[name]!]);
    }
  });

  it("marks directory entries and returns empty bytes for them", async () => {
    const zip = zipSync({ "dir/": new Uint8Array(0), "dir/f.txt": enc("x") });
    const handle = await openArchiveStream(new Blob([zip as BlobPart]));
    const dir = handle!.entries.find((e) => e.name === "dir/");
    expect(dir?.dir).toBe(true);
    expect((await handle!.read("dir/")).length).toBe(0);
  });

  it("returns null for a non-archive blob so the caller can fall back", async () => {
    expect(await openArchiveStream(new Blob([enc("not an archive")]))).toBeNull();
    expect(await openArchiveStream(new Blob([new Uint8Array(2)]))).toBeNull(); // too short
  });
});

describe("openArchiveStream: tar", () => {
  const files = [
    { name: "a.txt", data: enc("first file") },
    { name: "nested/deep/b.log", data: enc("x".repeat(2000)) },
    { name: "c.bin", data: new Uint8Array([0, 1, 2, 3, 255]) },
  ];

  it("lists and reads a plain tar via byte-range slices", async () => {
    const tar = writeTar(files);
    const handle = await openArchiveStream(new Blob([tar as BlobPart]), "x.tar");
    expect(handle).not.toBeNull();
    expect(handle!.entries.map((e) => e.name).sort()).toEqual(["a.txt", "c.bin", "nested/deep/b.log"]);
    for (const f of files) {
      expect([...(await handle!.read(f.name))]).toEqual([...f.data]);
    }
  });

  it("lists and reads a gzip-compressed tar (.tar.gz)", async () => {
    const tgz = gzipSync(writeTar(files));
    const handle = await openArchiveStream(new Blob([tgz as BlobPart]), "bundle.tar.gz");
    expect(handle).not.toBeNull();
    expect(handle!.entries.length).toBe(3);
    for (const f of files) {
      expect([...(await handle!.read(f.name))]).toEqual([...f.data]);
    }
  });

  it("does not treat a bare single-file .gz as a tarball", async () => {
    const gz = gzipSync(enc("just one file, not a tar"));
    expect(await openArchiveStream(new Blob([gz as BlobPart]), "notes.txt.gz")).toBeNull();
  });
});
