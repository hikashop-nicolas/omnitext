import { describe, expect, it } from "vitest";
import { t } from "./index";
import en from "./en";
import fr from "./fr";
import ja from "./ja";
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

  it("ja has exactly the same keys as en (the canonical set)", () => {
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });

  it("interpolates params and falls back to English / the key", () => {
    // Default locale is English in the test env (jsdom navigator.languages).
    expect(t("app.save")).toBe("Save");
    expect(t("status.ready", { where: "in this browser" })).toContain("in this browser");
    expect(t("nope.missing")).toBe("nope.missing"); // unknown key returns itself
  });

  // The collaboration strings are the newest plural users; en and fr differ in category
  // (French puts 0 and 1 in "one"), so a wrong key set here would show a broken sentence.
  it("has plural forms for the collaboration counts in every locale", () => {
    for (const dict of [en, fr, ja]) {
      for (const key of ["collab.connected", "collab.unread"]) {
        const node = key.split(".").reduce<unknown>((n, part) => (n as Dict)?.[part], dict);
        expect(typeof node).toBe("object");
        expect(node).toHaveProperty("other");
      }
    }
  });

  it("selects plural categories by count", () => {
    expect(t("history.changes", { n: 1, count: 1 })).toBe("1 change");
    expect(t("history.changes", { n: 3, count: 3 })).toBe("3 changes");
    expect(t("collab.connected", { n: 1, count: 1 })).toBe("Connected to 1 person");
    expect(t("collab.connected", { n: 4, count: 4 })).toBe("Connected to 4 people");
    expect(t("collab.unread", { n: 1, count: 1 })).toBe("1 unread message");
    expect(t("collab.unread", { n: 7, count: 7 })).toBe("7 unread messages");
  });
});
