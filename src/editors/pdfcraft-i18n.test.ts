import { describe, expect, it } from "vitest";
import fs from "node:fs";
import en from "../i18n/en";

// A label asked for by a literal key must exist, or the button shows the key itself.
describe("the PDF editor's labels", () => {
  it("are all defined", () => {
    const pdfcraft = (en as unknown as { pdfcraft: Record<string, string> }).pdfcraft;
    const missing = new Set<string>();
    for (const file of fs.readdirSync(new URL(".", import.meta.url)).filter((f) => /^pdfcraft.*\.ts$/.test(f) && !f.endsWith(".test.ts"))) {
      const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
      for (const m of source.matchAll(/\bt\(\s*["`]pdfcraft\.([A-Za-z0-9_]+)["`]/g)) if (!(m[1]! in pdfcraft)) missing.add(m[1]!);
    }
    expect([...missing]).toEqual([]);
  });
});
