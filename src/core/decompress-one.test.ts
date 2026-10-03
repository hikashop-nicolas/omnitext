import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decompressSingleFile } from "./decompress-one";

// A lone .xz or .bz2 carries one file and no archive, so it unwraps here rather than in
// libarchive. The size matters: xzwasm hands out each chunk as a view on its own memory,
// which it then writes over, so anything collected by reference rather than copied came
// back with the last chunk's bytes smeared through it. Everything shipped as a fixture
// used to be small enough to arrive in one chunk, where the bug cannot show.

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))));

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const BIG = Array.from({ length: 4000 }, (_, i) => `line ${String(i).padStart(6, "0")}: the quick brown fox jumps over the lazy dog`).join("\n") + "\n";

describe("a lone compressed file", () => {
  it("unwraps a small xz", async () => {
    expect(text((await decompressSingleFile(fixture("note.txt.xz")))!)).toBe("hello from an archive\n");
  });

  it("unwraps a small bzip2", async () => {
    expect(text((await decompressSingleFile(fixture("note.txt.bz2")))!)).toBe("hello from an archive\n");
  });

  it("unwraps an xz larger than one decoder chunk", async () => {
    const out = await decompressSingleFile(fixture("big.txt.xz"));
    expect(out).not.toBeNull();
    expect(out!.length, "every byte, not just the right count").toBe(BIG.length);
    expect(text(out!)).toBe(BIG);
  });

  it("leaves anything else alone", async () => {
    expect(await decompressSingleFile(new TextEncoder().encode("PK\u0003\u0004 not compressed"))).toBeNull();
  });
});
