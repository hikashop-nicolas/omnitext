// User settings, persisted in localStorage and shared with editor modules (e.g. the
// docx editor uses the name as the comment author).

const KEY = "omnitext:settings";

export type PageSize = "a4" | "letter";
export type Theme = "system" | "light" | "dark";

export interface Settings {
  name: string;
  /** Default page size for rich documents that declare none (richdoc). */
  pageSize: PageSize;
  /** Paginated (page cards) vs a single continuous page in the rich-document editor. */
  paginated: boolean;
  /** Color theme: follow the OS, or force light/dark. */
  theme: Theme;
  /**
   * A relay (TURN) server for collaboration, supplied by whoever is using the app.
   *
   * Most sessions never need one. It matters only for two peers whose networks cannot be
   * joined directly, which this app cannot fix for them: it runs no relay of its own, and
   * routing everyone's document through a server would undo the point of it.
   */
  turn?: { url: string; username: string; credential: string };
}

const DEFAULTS: Settings = {
  name: "",
  pageSize: "a4",
  paginated: true,
  theme: "system",
  turn: { url: "", username: "", credential: "" },
};

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
