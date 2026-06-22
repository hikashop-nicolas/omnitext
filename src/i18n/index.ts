// Tiny i18n runtime for the Omnitext app shell. Auto-detects the locale from the
// browser / device preferred-languages list, with English as the canonical key set
// and the fallback. No manual switcher and no persistence: detection runs each load.
//
// Adding a language = add `xx.ts` (mirroring en.ts) + one line in REGISTRY.

import en from "./en";

export type Dict = { [k: string]: string | Dict };
type Params = Record<string, string | number> & { count?: number };

// English is always bundled as the fallback; other locales load on demand.
const REGISTRY: Record<string, () => Promise<{ default: Dict }>> = {
  en: () => Promise.resolve({ default: en }),
  fr: () => import("./fr"),
};

let active: Dict = en;
let activeCode = "en";

export const getLocale = (): string => activeCode;

/** Pick the first preferred language we have a translation for, else English. */
export function detectLocale(): string {
  const prefs = (typeof navigator !== "undefined" && navigator.languages) || ["en"];
  for (const tag of prefs) {
    const base = tag.toLowerCase().split("-")[0]!;
    if (REGISTRY[base]) return base;
  }
  return "en";
}

/** Load the detected (non-English) locale before the first render. Safe to await once. */
export async function initI18n(): Promise<void> {
  const code = detectLocale();
  if (code === "en") return;
  try {
    active = (await REGISTRY[code]!()).default;
    activeCode = code;
    document.documentElement.lang = code;
  } catch {
    /* keep English */
  }
}

function lookup(dict: Dict, key: string): string | Dict | undefined {
  return key.split(".").reduce<string | Dict | undefined>((node, part) => {
    if (node && typeof node === "object") return node[part];
    return undefined;
  }, dict);
}

const interpolate = (s: string, params?: Params): string =>
  params ? s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : s;

/**
 * Translate a key (dot path). Falls back to English, then to the key itself. `{name}`
 * placeholders interpolate from `params`. When `params.count` is set and the entry is a
 * plural object ({ one, other, ... }), the matching category is chosen.
 */
export function t(key: string, params?: Params): string {
  let node = lookup(active, key);
  if (node === undefined) node = lookup(en, key);
  if (node === undefined) return key;
  if (typeof node === "object") {
    if (params?.count != null) {
      const cat = new Intl.PluralRules(activeCode).select(params.count);
      const chosen = node[cat] ?? node.other;
      if (typeof chosen === "string") return interpolate(chosen, params);
    }
    return key;
  }
  return interpolate(node, params);
}

/**
 * Resolve [data-i18n*] attributes in the DOM. `data-i18n` sets textContent;
 * `data-i18n-title` / `data-i18n-aria` / `data-i18n-placeholder` set those attributes.
 */
export function applyDom(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n]")))
    el.textContent = t(el.dataset.i18n!);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n-title]")))
    el.title = t(el.dataset.i18nTitle!);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n-aria]")))
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]")))
    (el as HTMLInputElement).placeholder = t(el.dataset.i18nPlaceholder!);
}
