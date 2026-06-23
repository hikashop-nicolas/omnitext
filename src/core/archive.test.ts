import { describe, expect, it } from "vitest";
import { detectArchiveKind, readArchive, writeArchive, type ArchiveEntry } from "./archive";
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
  }
});
