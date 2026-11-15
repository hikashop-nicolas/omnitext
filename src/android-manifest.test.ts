import { describe, expect, it } from "vitest";
import fs from "node:fs";

// "Open with" lists Omnitext only for the types the Android manifest names, so a format
// whose type is missing there cannot be opened from a file manager (a .kml was refused).
describe("the Android manifest", () => {
  const manifest = fs.readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const filters = [...manifest.matchAll(/<intent-filter[\s\S]*?<\/intent-filter>/g)].map((m) => m[0]);
  const types = (action: string) => {
    const filter = filters.find((f) => f.includes(`android.intent.action.${action}"`)) ?? "";
    return new Set([...filter.matchAll(/android:mimeType="([^"]+)"/g)].map((m) => m[1]!));
  };
  const declared = new Set<string>();
  for (const file of fs.readdirSync(new URL("./formats", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const source = fs.readFileSync(new URL(`./formats/${file}`, import.meta.url), "utf8");
    for (const list of source.matchAll(/mimeTypes: \[([^\]]*)\]/g)) for (const m of list[1]!.matchAll(/"([^"]+)"/g)) declared.add(m[1]!);
  }
  const covered = (set: Set<string>, type: string) => set.has(type) || set.has(`${type.split("/")[0]}/*`);

  it("offers Omnitext for every type a format declares, to open and to share", () => {
    expect(declared.size).toBeGreaterThan(50);
    for (const action of ["VIEW", "SEND"]) {
      const listed = types(action);
      expect([...declared].filter((type) => !covered(listed, type)), action).toEqual([]);
    }
  });
});
