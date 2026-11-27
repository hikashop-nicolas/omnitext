// Visible-range queries for the timeline: binary searches, per-pixel merging of slices too small
// to see, per-column counter extremes, and ruler ticks. Work is bounded by pixels, not events.

/** First index whose value is >= x (arr sorted ascending). */
export function lowerBound(arr: ArrayLike<number>, x: number, lo = 0, hi = arr.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose value is > x. */
export function upperBound(arr: ArrayLike<number>, x: number, lo = 0, hi = arr.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First slice ending at or after t: ends are sorted because slices of a level never overlap. */
export function firstEndingAfter(ts: Float64Array, dur: Float64Array, t: number): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ts[mid]! + dur[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Calls `draw(x0, x1, index, merged)` for each block to paint between t0 and t0 + width/scale
 * (scale in px per ns). Slices narrower than a pixel share one block per pixel column, and the
 * search jumps past the rest of that column, so a level of millions of slices costs about one
 * binary search per column.
 */
export function sliceBlocks(
  ts: Float64Array,
  dur: Float64Array,
  t0: number,
  width: number,
  scale: number,
  draw: (x0: number, x1: number, index: number, merged: boolean) => void,
): number {
  const n = ts.length;
  const t1 = t0 + width / scale;
  let i = firstEndingAfter(ts, dur, t0);
  let blocks = 0;
  while (i < n && ts[i]! <= t1) {
    const x0 = (ts[i]! - t0) * scale;
    const x1 = (ts[i]! + dur[i]! - t0) * scale;
    if (x1 - x0 >= 1) {
      draw(Math.max(x0, -1), Math.min(x1, width + 1), i, false);
      blocks++;
      i++;
      continue;
    }
    // A sub-pixel slice: everything else starting in this pixel column joins it.
    const col = Math.floor(x0);
    const colEnd = t0 + (col + 1) / scale;
    let j = lowerBound(ts, colEnd, i + 1);
    // The last slice starting in the column may reach past it: it is drawn on its own.
    if (j - 1 > i && ts[j - 1]! + dur[j - 1]! > colEnd) j--;
    const merged = j - i > 1;
    draw(col, col + 1, i, merged);
    blocks++;
    i = Math.max(j, i + 1);
  }
  return blocks;
}

/**
 * For each pixel column with samples, calls `draw(x, lo, hi)` with the value range the step
 * function takes in that column. Columns with many samples are sampled with a stride.
 */
export function counterColumns(
  ts: Float64Array,
  val: Float64Array,
  t0: number,
  width: number,
  scale: number,
  draw: (x: number, lo: number, hi: number) => void,
): void {
  const n = ts.length;
  if (!n) return;
  for (let x = 0; x < width; x++) {
    const a = t0 + x / scale;
    const b = t0 + (x + 1) / scale;
    if (b < ts[0]!) continue;
    let i = upperBound(ts, a) - 1; // the sample in force at the column start
    if (i < 0) i = 0;
    const j = lowerBound(ts, b, i);
    let lo = val[i]!;
    let hi = lo;
    const step = Math.max(1, Math.floor((j - i) / 64));
    for (let k = i + 1; k < j; k += step) {
      const v = val[k]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    draw(x, lo, hi);
  }
}

/** A 1, 2 or 5 times power of ten step (in ns) of at least `minNs`. */
export function niceStep(minNs: number): number {
  if (!(minNs > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(minNs)));
  for (const m of [1, 2, 5, 10]) if (m * p >= minNs) return m * p;
  return 10 * p;
}

export type TimeUnit = "nanosecond" | "microsecond" | "millisecond" | "second";

/** The unit to label ticks `step` ns apart, and its size in ns. */
export function tickUnit(step: number): [TimeUnit, number] {
  if (step >= 1e9) return ["second", 1e9];
  if (step >= 1e6) return ["millisecond", 1e6];
  if (step >= 1e3) return ["microsecond", 1e3];
  return ["nanosecond", 1];
}

/** The best unit to show a duration in. */
export function durationUnit(ns: number): [TimeUnit, number] {
  const a = Math.abs(ns);
  if (a >= 1e9) return ["second", 1e9];
  if (a >= 1e6) return ["millisecond", 1e6];
  if (a >= 1e3) return ["microsecond", 1e3];
  return ["nanosecond", 1];
}

/** Zooms [t0, t1] by `factor` (< 1 zooms in) around `anchor`, kept within [lo, hi]. */
export function zoomRange(t0: number, t1: number, anchor: number, factor: number, lo: number, hi: number, minSpan = 1000): [number, number] {
  const span = Math.min(Math.max((t1 - t0) * factor, minSpan), Math.max(hi - lo, minSpan));
  const r = t1 > t0 ? (anchor - t0) / (t1 - t0) : 0.5;
  let a = anchor - span * r;
  return clampRange(a, a + span, lo, hi);
}

/** Moves [t0, t1] back inside [lo, hi] without changing its span when it fits. */
export function clampRange(t0: number, t1: number, lo: number, hi: number): [number, number] {
  const span = t1 - t0;
  if (span >= hi - lo) return [lo + (hi - lo - span) / 2, lo + (hi - lo + span) / 2];
  if (t0 < lo) return [lo, lo + span];
  if (t1 > hi) return [hi - span, hi];
  return [t0, t1];
}
