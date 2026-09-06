import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectArchiveKind, readArchiveAsync, writeArchiveAsync } from "./archive";
import { writeSevenZip } from "./sevenzip";

// Saving a file edited from inside a .7z means rebuilding the archive, so what matters is
// that everything else in it survives the round trip unchanged. These write with 7-Zip and
// read back with libarchive, which is the same pairing the app uses.

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))));

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const byName = (entries: { name: string; data: Uint8Array }[]): Map<string, Uint8Array> =>
  new Map(entries.filter((e) => !e.name.endsWith("/")).map((e) => [e.name.replace(/^\.?\//, ""), e.data]));

describe("writing a 7z", () => {
  it("produces something that reads back as a 7z", async () => {
    const out = await writeSevenZip([{ name: "hello.txt", data: enc("hi\n") }]);
    expect(detectArchiveKind(out)).toBe("7z");
    const back = byName(await readArchiveAsync(out));
    expect(text(back.get("hello.txt")!)).toBe("hi\n");
  });

  it("keeps entries in subdirectories where they were", async () => {
    const out = await writeSevenZip([
      { name: "note.txt", data: enc("top level\n") },
      { name: "src/data.json", data: enc('{"n":1}\n') },
      { name: "src/deep/again.txt", data: enc("two down\n") },
    ]);
    const back = byName(await readArchiveAsync(out));
    expect([...back.keys()].sort()).toEqual(["note.txt", "src/data.json", "src/deep/again.txt"]);
    expect(text(back.get("src/deep/again.txt")!)).toBe("two down\n");
  });

  it("actually compresses, rather than storing", async () => {
    // A megabyte of one repeated line: anything doing real work returns far less than this.
    const big = enc("the same line over and over\n".repeat(40_000));
    const out = await writeSevenZip([{ name: "big.txt", data: big }]);
    expect(out.length).toBeLessThan(big.length / 10);
    const back = byName(await readArchiveAsync(out));
    expect(back.get("big.txt")!.length).toBe(big.length);
  });

  it("survives being called twice, leaving nothing of the first archive in the second", async () => {
    await writeSevenZip([{ name: "first.txt", data: enc("one\n") }]);
    const second = await writeSevenZip([{ name: "second.txt", data: enc("two\n") }]);
    const back = byName(await readArchiveAsync(second));
    expect([...back.keys()]).toEqual(["second.txt"]);
  });

  it("handles binary content, not just text", async () => {
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
    const out = await writeSevenZip([{ name: "blob.bin", data: bytes }]);
    const back = byName(await readArchiveAsync(out));
    expect([...back.get("blob.bin")!]).toEqual([...bytes]);
  });
});

describe("editing a file inside a 7z and saving it back", () => {
  it("replaces the one entry and leaves the others alone", async () => {
    // Exactly what the app does on save: read every entry, swap one, write the kind back.
    const original = fixture("sample.7z");
    const kind = detectArchiveKind(original);
    expect(kind).toBe("7z");

    const entries = await readArchiveAsync(original);
    const target = entries.find((e) => e.name.endsWith("note.txt"))!;
    target.data = enc("edited in the browser\n");
    const rebuilt = await writeArchiveAsync(kind!, entries);

    const back = byName(await readArchiveAsync(rebuilt));
    expect(text(back.get("note.txt")!)).toBe("edited in the browser\n");
    expect(text(back.get("src/data.json")!)).toBe('{"n":1}\n'); // untouched
  });
});
