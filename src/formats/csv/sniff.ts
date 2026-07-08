// Delimiter sniffing for CSV-family text. Counts candidate delimiters per line
// (quote-aware, so separators inside quoted fields are ignored) and picks the
// candidate whose per-line count is most consistent. This is what lets a
// semicolon CSV (the French/German Excel default) open as a grid instead of a
// single column, without any user setting.

export const CSV_DELIMITER_CANDIDATES = [",", ";", "\t", "|"] as const;

const MAX_LINES = 20;
const MAX_CHARS = 65536;

/** Per-candidate delimiter counts for the first physical lines of the text. */
function countPerLine(text: string): Map<string, number[]> {
  const counts = new Map<string, number[]>(CSV_DELIMITER_CANDIDATES.map((c) => [c, [0]]));
  let inQuotes = false;
  let line = 0;
  const limit = Math.min(text.length, MAX_CHARS);
  for (let i = 0; i < limit && line < MAX_LINES; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
      for (const arr of counts.values()) arr.push(0);
      continue;
    }
    const arr = counts.get(ch);
    if (arr && !inQuotes) arr[line]!++;
  }
  return counts;
}

/** Drop a trailing line that is empty for every candidate (trailing newline artifact). */
function trimTrailingEmpty(counts: Map<string, number[]>): number {
  const arrays = [...counts.values()];
  let len = arrays[0]!.length;
  while (len > 1 && arrays.every((a) => a[len - 1] === 0)) len--;
  return len;
}

interface Score {
  delimiter: string;
  /** Lines whose count equals the modal count (and that count is > 0). */
  consistent: number;
  /** The modal per-line count. */
  modal: number;
  lines: number;
}

function scoreCandidate(delimiter: string, perLine: number[], lines: number): Score {
  const freq = new Map<number, number>();
  for (let i = 0; i < lines; i++) {
    const n = perLine[i]!;
    freq.set(n, (freq.get(n) ?? 0) + 1);
  }
  let modal = 0;
  let modalFreq = 0;
  for (const [n, f] of freq) {
    // Prefer the most frequent nonzero count; higher count wins ties so "a;b;c"
    // beats a stray single semicolon.
    if (n > 0 && (f > modalFreq || (f === modalFreq && n > modal))) {
      modal = n;
      modalFreq = f;
    }
  }
  return { delimiter, consistent: modal > 0 ? modalFreq : 0, modal, lines };
}

/** Best-scoring candidate for the text, or null when nothing looks delimited. */
export function sniffScore(text: string): Score | null {
  const counts = countPerLine(text);
  const lines = trimTrailingEmpty(counts);
  let best: Score | null = null;
  for (const c of CSV_DELIMITER_CANDIDATES) {
    const s = scoreCandidate(c, counts.get(c)!, lines);
    if (s.consistent === 0) continue;
    // Candidate order is the tie-break: comma beats semicolon beats tab beats pipe.
    if (!best || s.consistent > best.consistent) best = s;
  }
  return best;
}

/** The delimiter to parse this text with. Falls back to a comma. */
export function sniffDelimiter(text: string): string {
  return sniffScore(text)?.delimiter ?? ",";
}

/**
 * Content-based confidence that this text is delimiter-separated values, for
 * format detection on extension-less files. Demands structure (2+ columns,
 * consistent across 2+ lines) so prose with commas no longer routes to the grid.
 */
export function sniffConfidence(text: string): number {
  const s = sniffScore(text);
  if (!s || s.lines < 2 || s.modal < 1) return 0;
  const ratio = s.consistent / s.lines;
  if (ratio === 1 && s.modal >= 2) return 0.5;
  // One delimiter per line could be prose punctuation; ask for a third line.
  if (ratio === 1 && s.lines >= 3) return 0.3;
  return ratio >= 0.8 && s.modal >= 2 ? 0.3 : 0;
}
