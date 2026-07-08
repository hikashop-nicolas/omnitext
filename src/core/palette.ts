// Fuzzy matching for the command palette, kept pure so the ranking is testable.
// Subsequence match with the usual bonuses: consecutive runs, word starts, and
// a penalty for gaps. Case-insensitive; diacritics fold so "e" matches "é".

export interface PaletteEntry {
  label: string;
  /** Secondary text shown dimmed (e.g. a keybinding or category). */
  hint?: string;
  run(): void;
}

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Score a query against a label; null when the query is not a subsequence. */
export function fuzzyScore(query: string, label: string): number | null {
  const q = fold(query);
  const l = fold(label);
  if (!q) return 0;
  let score = 0;
  let li = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    for (let i = li; i < l.length; i++) {
      if (l[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    score += 1;
    if (found === prevMatch + 1) score += 2; // consecutive run
    if (found === 0 || l[found - 1] === " " || l[found - 1] === ":") score += 3; // word start
    score -= Math.min(3, (found - li) * 0.1); // gap penalty, bounded
    prevMatch = found;
    li = found + 1;
  }
  return score;
}

/** Entries matching the query, best first; stable for equal scores. */
export function filterEntries<T extends { label: string }>(entries: T[], query: string): T[] {
  if (!query) return entries.slice();
  return entries
    .map((e, i) => ({ e, i, s: fuzzyScore(query, e.label) }))
    .filter((x): x is { e: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.e);
}
