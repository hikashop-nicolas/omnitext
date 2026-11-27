// Format-specific figures a reader hands the Overview tab. Labels are i18n keys under
// "perfetto." so readers stay free of UI strings.

export type StatKind = "text" | "count" | "dur" | "pct";

export interface StatFact {
  key: string;
  value: string | number;
  kind?: StatKind;
}

export interface StatTable {
  title: string;
  cols: { key: string; kind: StatKind }[];
  rows: (string | number)[][];
  /** Column drawn as a bar next to the rows, biggest first. */
  bar?: number;
}

export interface TraceStats {
  facts: StatFact[];
  tables: StatTable[];
}

export const emptyStats = (): TraceStats => ({ facts: [], tables: [] });

/** Rows of a name to [count, total] map, as a table sorted on `by` (1 count, 2 total). */
export function tally(map: Map<string, [number, number]>, by: 1 | 2, cap = 200): (string | number)[][] {
  return [...map].map(([k, [n, sum]]) => [k, n, sum]).sort((a, b) => (b[by] as number) - (a[by] as number)).slice(0, cap);
}
