// User settings, persisted in localStorage and shared with editor modules (e.g. the
// docx editor uses the name as the comment author).

const KEY = "omnitext:settings";

export type PageSize = "a4" | "letter";
export type Theme = "system" | "light" | "dark";
export type Locale = "auto" | "en" | "fr" | "ja";

export interface Settings {
  name: string;
  /** Default page size for rich documents that declare none (richdoc). */
  pageSize: PageSize;
  /** Paginated (page cards) vs a single continuous page in the rich-document editor. */
  paginated: boolean;
  /** Color theme: follow the OS, or force light/dark. */
  theme: Theme;
  /** UI language: "auto" follows the device, else a forced locale code. */
  locale: Locale;
}

const DEFAULTS: Settings = { name: "", pageSize: "a4", paginated: true, theme: "system", locale: "auto" };

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore malformed settings */
  }
  return { ...DEFAULTS };
}

export function saveSettings(patch: Partial<Settings>): void {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable; settings stay in-memory only */
  }
}

/** The user's display name, or undefined if unset. */
export const userName = (): string | undefined => getSettings().name.trim() || undefined;
