// User settings, persisted in localStorage and shared with editor modules (e.g. the
// docx editor uses the name as the comment author).

const KEY = "omnitext:settings";

export interface Settings {
  name: string;
}

const DEFAULTS: Settings = { name: "" };

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
