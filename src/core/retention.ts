// Retention policies for the two IndexedDB stores, as pure functions so the
// rules are unit-testable without a browser. The stores apply the returned ids.
//
// Crash-recovery snapshots (SessionStore): one per document session, only the
// recent ones matter. Version history (VersionStore): bounded per document,
// preferring to drop automatic snapshots before deliberate ones, and whole
// documents nobody touched in months.

export const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const SESSION_MAX_COUNT = 20;
export const VERSIONS_PER_KEY = 100;
export const VERSION_KEY_MAX_AGE_MS = 90 * 24 * 3600 * 1000;

/** Labels a user did not explicitly ask for; dropped first when over the cap. */
const DISPOSABLE_LABELS = new Set(["Auto", "Opened"]);

export interface SessionMeta {
  id: string;
  updatedAt: number;
}

/** Crash-recovery snapshots to delete: too old or beyond the newest N. The
    current session is never dropped, whatever its age. */
export function staleSessionIds(
  sessions: SessionMeta[],
  now: number,
  keepId: string | null = null,
  maxAgeMs = SESSION_MAX_AGE_MS,
  maxCount = SESSION_MAX_COUNT,
): string[] {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const out: string[] = [];
  sorted.forEach((s, i) => {
    if (s.id === keepId) return;
    if (i >= maxCount || now - s.updatedAt >= maxAgeMs) out.push(s.id); // >=: maxAge 0 means "all but kept"
  });
  return out;
}

export interface VersionMeta {
  id?: number;
  ts: number;
  label: string;
}

/** Version ids to delete so a document keeps at most `cap` versions, shedding
    automatic snapshots (Auto/Opened) before deliberate ones (Manual/Saved). */
export function versionIdsToDrop(versions: VersionMeta[], cap = VERSIONS_PER_KEY): number[] {
  const excess = versions.length - cap;
  if (excess <= 0) return [];
  const oldestFirst = (a: VersionMeta, b: VersionMeta) => a.ts - b.ts;
  const disposable = versions.filter((v) => DISPOSABLE_LABELS.has(v.label)).sort(oldestFirst);
  const deliberate = versions.filter((v) => !DISPOSABLE_LABELS.has(v.label)).sort(oldestFirst);
  return [...disposable, ...deliberate]
    .slice(0, excess)
    .map((v) => v.id)
    .filter((id): id is number => id !== undefined);
}

/** Document keys whose newest version is older than the stale horizon. */
export function staleVersionKeys(newestTsByKey: Map<string, number>, now: number, maxAgeMs = VERSION_KEY_MAX_AGE_MS): string[] {
  const out: string[] = [];
  for (const [key, ts] of newestTsByKey) if (now - ts > maxAgeMs) out.push(key);
  return out;
}

/** Browser storage quota errors, across the names browsers use for them. */
export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22;
}
