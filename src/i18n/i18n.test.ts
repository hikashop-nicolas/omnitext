import { describe, expect, it } from "vitest";
import { t } from "./index";
import en from "./en";
import fr from "./fr";
import type { Dict } from "./index";

// Collect every dotted leaf key in a dict.
function keys(d: Dict, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(path);
    else out.push(...keys(v, path));
  }
  return out;
}

describe("i18n", () => {
  it("fr has exactly the same keys as en (the canonical set)", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });

  it("interpolates params and falls back to English / the key", () => {
    // Default locale is English in the test env (jsdom navigator.languages).
    expect(t("app.save")).toBe("Save");
    expect(t("status.ready", { where: "in this browser" })).toContain("in this browser");
    expect(t("nope.missing")).toBe("nope.missing"); // unknown key returns itself
  });

  it("selects plural categories by count", () => {
    expect(t("history.changes", { n: 1, count: 1 })).toBe("1 change");
    expect(t("history.changes", { n: 3, count: 3 })).toBe("3 changes");
  });
});
