import { describe, expect, it } from "vitest";
import { t } from "./index";
import en from "./en";
import fr from "./fr";
import ja from "./ja";
import es from "./es";
import de from "./de";
import pt from "./pt";
import ru from "./ru";
import zh from "./zh";
import type { Dict } from "./index";

const LOCALES: [string, Dict][] = [
  ["fr", fr],
  ["ja", ja],
  ["es", es],
  ["de", de],
  ["pt", pt],
  ["ru", ru],
  ["zh", zh],
];

const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"];

/** A plural entry is an object whose keys are all plural categories. */
const isPlural = (v: Dict): boolean => {
  const ks = Object.keys(v);
  return ks.length > 0 && ks.every((k) => PLURAL_CATEGORIES.includes(k));
};

/**
 * Every key, with a plural entry counted as one key rather than one per category.
 *
 * That distinction is the point: Russian needs "few" and "many" where English has neither,
 * so comparing raw leaf keys would reject a correct Russian dictionary.
 */
function keys(d: Dict, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(path);
    else if (isPlural(v)) out.push(path);
    else out.push(...keys(v, path));
  }
  return out;
}

/** Dotted paths of every plural entry in a dict. */
function pluralKeys(d: Dict, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "string") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlural(v)) out.push(path);
    else out.push(...pluralKeys(v, path));
  }
  return out;
}

const at = (d: Dict, key: string): unknown =>
  key.split(".").reduce<unknown>((n, part) => (n as Dict)?.[part], d);

/** The `{placeholders}` a string expects, sorted. */
const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

/** Every string in a dict, by dotted path, flattening plural categories. */
function strings(d: Dict, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(d)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push([path, v]);
    else out.push(...strings(v, path));
  }
  return out;
}

describe("i18n", () => {
  it.each(LOCALES)("%s covers exactly the English key set", (_code, dict) => {
    expect(keys(dict).sort()).toEqual(keys(en).sort());
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
    expect(t("collab.connected", { n: 1, count: 1 })).toBe("Connected to 1 person");
    expect(t("collab.connected", { n: 4, count: 4 })).toBe("Connected to 4 people");
    expect(t("collab.unread", { n: 1, count: 1 })).toBe("1 unread message");
    expect(t("collab.unread", { n: 7, count: 7 })).toBe("7 unread messages");
  });

  // What actually matters about plurals is that no count falls through to the wrong form.
  // Checking the categories a language declares would not catch it: Spanish declares "many"
  // but never selects it for a plain integer, while Russian selects "few" for 2 and "many"
  // for 5, and a dictionary missing those would silently render the singular.
  it.each([["en", en] as [string, Dict], ...LOCALES])(
    "%s has a form for every count its own plural rules can produce",
    (code, dict) => {
      const rules = new Intl.PluralRules(code);
      for (const key of pluralKeys(en)) {
        const node = at(dict, key) as Dict | undefined;
        expect(node, `${code} is missing the plural entry ${key}`).toBeDefined();
        for (let n = 0; n <= 200; n++) {
          const category = rules.select(n);
          expect(
            node![category],
            `${code} ${key}: no "${category}" form, needed for n=${n}`,
          ).toBeTypeOf("string");
        }
      }
    },
  );

  // A translation that drops {name} loses the thing the sentence was about, and one that
  // invents {nom} renders the braces to the reader. Neither shows up as a missing key.
  it.each(LOCALES)("%s keeps the placeholders English uses", (code, dict) => {
    const english = new Map(strings(en));
    for (const [key, value] of strings(dict)) {
      const expected = english.get(key);
      if (expected === undefined) continue; // a plural category English lacks (ru few/many)
      expect(placeholders(value), `${code} ${key}`).toEqual(placeholders(expected));
    }
  });

  // Russian and Chinese carry categories English has no string for, so those are compared
  // against the English "other" form instead of being skipped entirely.
  it.each(LOCALES)("%s keeps the placeholders in its extra plural forms", (code, dict) => {
    for (const key of pluralKeys(en)) {
      const englishOther = at(en, `${key}.other`) as string;
      const node = at(dict, key) as Dict;
      for (const [category, form] of Object.entries(node)) {
        expect(placeholders(form as string), `${code} ${key}.${category}`).toEqual(
          placeholders(englishOther),
        );
      }
    }
  });
});
