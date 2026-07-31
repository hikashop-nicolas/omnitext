// Opt-in debug logging, by area.
//
// The reason this exists: checking that collaboration works meant reading a grid through a
// browser-automation tool and inferring what had happened from what appeared on screen.
// When something did not appear there was no way to tell whether the message was never
// sent, never arrived, or arrived and was ignored. Those are three different bugs and they
// look identical from outside.
//
// Enable with ?debug=collab or ?debug=collab,wire, or persistently with
// localStorage["omnitext:debug"] = "collab". "all" turns everything on. Off by default and
// costs nothing when off: the arguments are not even evaluated.

export type DebugArea =
  /** Session lifecycle: joining, binding, base transfer, removal. */
  | "collab"
  /** What actually crosses the wire, per message. Loud. */
  | "wire"
  /** Presence: who is where. */
  | "peers";

const KEY = "omnitext:debug";

function enabledAreas(): Set<string> {
  const out = new Set<string>();
  const add = (raw: string | null | undefined): void => {
    for (const part of (raw ?? "").split(",")) {
      const name = part.trim().toLowerCase();
      if (name) out.add(name);
    }
  };
  try {
    if (typeof location !== "undefined") add(new URLSearchParams(location.search).get("debug"));
    if (typeof localStorage !== "undefined") add(localStorage.getItem(KEY));
  } catch {
    /* storage may be unavailable; the query string alone still works */
  }
  return out;
}

let areas = enabledAreas();

/** Re-read the flags. For tests, and for a console that just set one. */
export function refreshDebug(): void {
  areas = enabledAreas();
}

export const debugEnabled = (area: DebugArea): boolean => areas.has("all") || areas.has(area);

/**
 * Log one line for an area, if that area is on.
 *
 * `detail` is a function rather than a value so that building the message costs nothing
 * when the area is off: serialising every cell change on every keystroke would be a real
 * cost to pay for logging nobody asked for.
 */
export function debug(area: DebugArea, message: string, detail?: () => unknown): void {
  if (!debugEnabled(area)) return;
  const at = new Date().toISOString().slice(11, 23);
  if (detail) console.info(`[${at}] ${area}: ${message}`, detail());
  else console.info(`[${at}] ${area}: ${message}`);
}

/**
 * A counter for things too frequent to log individually, reported on demand.
 *
 * Sync messages arrive per keystroke; a line each drowns the console and hides the one
 * event that mattered. A running total answers "is anything crossing at all", which is the
 * question being asked.
 */
export class DebugTally {
  private readonly counts = new Map<string, number>();

  constructor(private readonly area: DebugArea) {}

  add(what: string, n = 1): void {
    if (!debugEnabled(this.area)) return;
    this.counts.set(what, (this.counts.get(what) ?? 0) + n);
  }

  /** What has been counted so far, for a report or a test. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  report(label: string): void {
    if (!debugEnabled(this.area) || !this.counts.size) return;
    debug(this.area, label, () => this.snapshot());
  }
}
