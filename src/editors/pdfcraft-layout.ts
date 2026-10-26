// Page geometry for the new PDF editor, kept free of the DOM so it can be tested.

export interface PageSize {
  w: number;
  h: number;
}

export interface Layout {
  tops: number[];
  widths: number[];
  heights: number[];
  total: number;
}

/** The zoom at which the widest page fills `containerWidth` (less `padding` on each side). */
export function fitZoom(containerWidth: number, pages: PageSize[], padding = 12): number {
  const widest = pages.reduce((m, p) => Math.max(m, p.w), 0);
  if (!(widest > 0) || !(containerWidth > 0)) return 1;
  return Math.max(0.05, (containerWidth - 2 * padding) / widest);
}

/** Pages stacked top to bottom with `gap` between them; sizes in CSS pixels at `zoom`. */
export function layoutPages(pages: PageSize[], zoom: number, gap = 12): Layout {
  const tops: number[] = [];
  const widths: number[] = [];
  const heights: number[] = [];
  let y = gap;
  for (const p of pages) {
    tops.push(y);
    widths.push(p.w * zoom);
    heights.push(p.h * zoom);
    y += p.h * zoom + gap;
  }
  return { tops, widths, heights, total: y };
}

/** The first and last page that touch the viewport widened by `margin` on both sides, or null. */
export function visibleRange(l: Layout, scrollTop: number, viewport: number, margin = 0): [number, number] | null {
  const from = scrollTop - margin;
  const to = scrollTop + viewport + margin;
  let first = -1;
  let last = -1;
  for (let i = 0; i < l.tops.length; i++) {
    const top = l.tops[i]!;
    const bottom = top + l.heights[i]!;
    if (bottom >= from && top <= to) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? null : [first, last];
}

/** The page whose middle is nearest the middle of the viewport. */
export function currentPage(l: Layout, scrollTop: number, viewport: number): number {
  const mid = scrollTop + viewport / 2;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < l.tops.length; i++) {
    const d = Math.abs(l.tops[i]! + l.heights[i]! / 2 - mid);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** Device pixels per point for a render: the zoom times the screen density, held under `maxPixels`. */
export function renderScale(zoom: number, dpr: number, page: PageSize, maxPixels = 16_000_000): number {
  const wanted = Math.max(0.1, zoom * dpr);
  const pixels = page.w * wanted * (page.h * wanted);
  return pixels > maxPixels ? wanted * Math.sqrt(maxPixels / pixels) : wanted;
}

type Box = [number, number, number, number];

/** The smallest block containing the point (x, y), in the same units as the boxes, or -1. */
export function hitBlock(boxes: readonly (Box | null)[], x: number, y: number, slop = 2): number {
  let best = -1;
  let bestArea = Infinity;
  boxes.forEach((b, i) => {
    if (!b) return;
    if (x >= b[0] - slop && x <= b[2] + slop && y >= b[1] - slop && y <= b[3] + slop) {
      const area = (b[2] - b[0]) * (b[3] - b[1]);
      if (area < bestArea) {
        best = i;
        bestArea = area;
      }
    }
  });
  return best;
}

/** The zoom at which a whole page fits the view, width and height (less `padding` around it). */
export function fitPageZoom(containerWidth: number, containerHeight: number, page: PageSize, padding = 12): number {
  if (!(page.w > 0 && page.h > 0) || !(containerWidth > 0) || !(containerHeight > 0)) return 1;
  return Math.max(0.05, Math.min((containerWidth - 2 * padding) / page.w, (containerHeight - 2 * padding) / page.h));
}

export type Handle = "nw" | "ne" | "sw" | "se" | "e";

/**
 * A box dragged by one of its handles by (dx, dy). The opposite corner (or the left edge, for the
 * east handle) stays put, and the box never gets smaller than `min` or leaves the page `bounds`.
 */
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number, min = 12, bounds?: PageSize): Box {
  let [x0, y0, x1, y1] = box;
  if (handle === "nw" || handle === "sw") x0 = Math.min(x0 + dx, x1 - min);
  if (handle === "ne" || handle === "se" || handle === "e") x1 = Math.max(x1 + dx, x0 + min);
  if (handle === "nw" || handle === "ne") y0 = Math.min(y0 + dy, y1 - min);
  if (handle === "sw" || handle === "se") y1 = Math.max(y1 + dy, y0 + min);
  if (bounds) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(bounds.w, x1);
    y1 = Math.min(bounds.h, y1);
  }
  return [x0, y0, x1, y1];
}

/** A box between two corners given in any order, kept inside the page. */
export function boxBetween(a: [number, number], b: [number, number], bounds: PageSize): Box {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return [clamp(Math.min(a[0], b[0]), bounds.w), clamp(Math.min(a[1], b[1]), bounds.h), clamp(Math.max(a[0], b[0]), bounds.w), clamp(Math.max(a[1], b[1]), bounds.h)];
}

/** Where a new text box goes for a tap at (x, y): `width` wide, `height` tall, inside the page. */
export function newTextBox(x: number, y: number, page: PageSize, width = 160, height = 36, margin = 8): Box {
  const w = Math.min(width, page.w - 2 * margin);
  const left = Math.min(Math.max(margin, x), page.w - margin - w);
  const top = Math.min(Math.max(margin, y), page.h - margin - height);
  return [left, top, left + w, top + height];
}
