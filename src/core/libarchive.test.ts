import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractWithLibarchive, isLibarchiveArchive, openLibarchiveStream } from "./libarchive";

// The formats fflate cannot read (7z, RAR, xz, bzip2) go through libarchive compiled to
// wasm. Nothing covered this before: the zip and tar paths had tests, and everything the
// archive viewer claims about 7z and friends rested on the wrapper being right.
//
// See __fixtures__/README.md for what each archive holds and how to remake it, including
// why there is no RAR one.

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))));

const NOTE = "hello from an archive\n";
const DATA = '{"n":1}\n';
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// Every fixture holds the same two files, so one expectation covers all the containers.
const expectBothFiles = (entries: { name: string; data: Uint8Array }[]): void => {
  const byName = new Map(entries.map((e) => [e.name.replace(/^\.\//, ""), e.data]));
  expect([...byName.keys()].sort()).toEqual(["note.txt", "src/data.json"]);
  expect(text(byName.get("note.txt")!)).toBe(NOTE);
  expect(text(byName.get("src/data.json")!)).toBe(DATA);
};

describe("recognising what libarchive should handle", () => {
  it("claims 7z, RAR, xz and bzip2 by their signature", () => {
    expect(isLibarchiveArchive(fixture("sample.7z"))).toBe(true);
    expect(isLibarchiveArchive(fixture("sample.tar.xz"))).toBe(true);
    expect(isLibarchiveArchive(fixture("sample.tar.bz2"))).toBe(true);
    // RAR cannot be created without the proprietary tool, so the signature is as far as
    // this goes. Both RAR 4 and RAR 5 begin with these six bytes.
    expect(isLibarchiveArchive(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))).toBe(true);
    expect(isLibarchiveArchive(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]))).toBe(true);
  });

  it("leaves zip, gzip and tar to fflate", () => {
    expect(isLibarchiveArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false); // zip
    expect(isLibarchiveArchive(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(false); // gzip
    expect(isLibarchiveArchive(new Uint8Array(8))).toBe(false); // nothing at all
  });

  it("does not mistake a short file for an archive", () => {
    expect(isLibarchiveArchive(new Uint8Array([0x37, 0x7a]))).toBe(false); // a truncated 7z magic
    expect(isLibarchiveArchive(new Uint8Array(0))).toBe(false);
  });
});

describe("extracting", () => {
  it("reads every entry of a 7z, subdirectory and all", async () => {
    expectBothFiles(await extractWithLibarchive(fixture("sample.7z"), "unused"));
  });

  it("reads a tar wrapped in xz", async () => {
    expectBothFiles(await extractWithLibarchive(fixture("sample.tar.xz"), "unused"));
  });

  it("reads a tar wrapped in bzip2", async () => {
    expectBothFiles(await extractWithLibarchive(fixture("sample.tar.bz2"), "unused"));
  });

  // A bare .xz or .bz2 holds one compressed file and no archive inside it, which libarchive
  // will not read: its wasm enables archive_read_support_format_all(), and the "raw" format
  // is deliberately left out of that set. So these unwrap through a decompressor instead,
  // and the name comes from the caller because the stream carries none.
  it("reads a bare xz of a single file, named by the caller", async () => {
    const entries = await extractWithLibarchive(fixture("note.txt.xz"), "note.txt");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("note.txt");
    expect(text(entries[0]!.data)).toBe(NOTE);
  });

  it("reads a bare bzip2 of a single file, named by the caller", async () => {
    const entries = await extractWithLibarchive(fixture("note.txt.bz2"), "note.txt");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("note.txt");
    expect(text(entries[0]!.data)).toBe(NOTE);
  });

  it("still refuses something that is neither an archive nor compressed", async () => {
    const notAnArchive = new TextEncoder().encode("just some text, honestly");
    await expect(extractWithLibarchive(notAnArchive, "x")).rejects.toThrow(/could not be read/);
  });
});

describe("listing before reading", () => {
  it("lists names and sizes without pulling any body onto the heap", async () => {
    const handle = await openLibarchiveStream(fixture("sample.7z"), "unused");
    const listed = handle.entries
      .filter((e) => !e.dir)
      .map((e) => ({ name: e.name.replace(/^\.\//, ""), size: e.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(listed).toEqual([
      { name: "note.txt", size: NOTE.length },
      { name: "src/data.json", size: DATA.length },
    ]);
  });

  it("reads one entry on demand, leaving the rest alone", async () => {
    const handle = await openLibarchiveStream(fixture("sample.tar.xz"), "unused");
    const name = handle.entries.find((e) => e.name.endsWith("data.json"))!.name;
    expect(text(await handle.read(name))).toBe(DATA);
  });

  it("reads the same entry twice, since each read rescans the archive", async () => {
    const handle = await openLibarchiveStream(fixture("sample.tar.bz2"), "unused");
    const name = handle.entries.find((e) => e.name.endsWith("note.txt"))!.name;
    expect(text(await handle.read(name))).toBe(NOTE);
    expect(text(await handle.read(name))).toBe(NOTE);
  });

  it("rejects a name the archive does not hold", async () => {
    const handle = await openLibarchiveStream(fixture("sample.7z"), "unused");
    await expect(handle.read("nothing/here.txt")).rejects.toThrow(/no entry/);
  });

  it("presents a bare xz as the one file it holds", async () => {
    const handle = await openLibarchiveStream(fixture("note.txt.xz"), "note.txt");
    expect(handle.entries).toEqual([{ name: "note.txt", size: NOTE.length, dir: false }]);
    expect(text(await handle.read("note.txt"))).toBe(NOTE);
    await expect(handle.read("other.txt")).rejects.toThrow(/no entry/);
  });

  it("presents a bare bzip2 as the one file it holds", async () => {
    const handle = await openLibarchiveStream(fixture("note.txt.bz2"), "note.txt");
    expect(handle.entries).toEqual([{ name: "note.txt", size: NOTE.length, dir: false }]);
    expect(text(await handle.read("note.txt"))).toBe(NOTE);
  });
});
