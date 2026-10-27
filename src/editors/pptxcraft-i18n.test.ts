import { describe, expect, it } from "vitest";
import fs from "node:fs";
import en from "../i18n/en";

// A label asked for by a literal key must exist, or the button shows the key itself.
describe("the presentation editor's labels", () => {
  it("are all defined", () => {
    const labels = (en as unknown as { pptxcraft: Record<string, string> }).pptxcraft;
    const missing = new Set<string>();
    for (const file of fs.readdirSync(new URL(".", import.meta.url)).filter((f) => /^pptxcraft.*\.ts$/.test(f) && !f.endsWith(".test.ts"))) {
      const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
      for (const m of source.matchAll(/\bt\(\s*["`]pptxcraft\.([A-Za-z0-9_]+)["`]/g)) if (!(m[1]! in labels)) missing.add(m[1]!);
      for (const m of source.matchAll(/\["[A-Za-z0-9]+", "((?:shape|layout)[A-Za-z0-9]+)"\]/g)) if (!(m[1]! in labels)) missing.add(m[1]!);
    }
    expect([...missing]).toEqual([]);
  });
});
