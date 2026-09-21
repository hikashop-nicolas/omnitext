import { describe, it, expect } from "vitest";
import { mostlyText } from "./binary.impl";

const enc = (s: string) => new TextEncoder().encode(s);

describe("hex viewer: mostlyText", () => {
  it("spots text the sniff sent to hex", () => {
    const log = enc("[    0.000000] Booting Linux on physical CPU 0x0\n".repeat(10));
    const withGaps = new Uint8Array(log.length + 6);
    withGaps.set(log.subarray(0, 100));
    withGaps.set(log.subarray(100), 106); // a short NUL run mid-file
    expect(mostlyText(withGaps)).toBe(true);
    expect(mostlyText(enc("Crème brûlée, 日本語のテキスト\n".repeat(5)))).toBe(true);
  });

  it("leaves compressed data alone", () => {
    const noise = Uint8Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) % 256);
    expect(mostlyText(noise)).toBe(false);
    expect(mostlyText(enc("hi"))).toBe(false); // too little to judge
  });
});
