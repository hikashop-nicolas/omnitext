import { describe, expect, it } from "vitest";
import { currentPage, fitZoom, hitBlock, layoutPages, renderScale, visibleRange } from "./pdfcraft-layout";

const pages = [
  { w: 200, h: 300 },
  { w: 200, h: 300 },
  { w: 300, h: 200 },
];

describe("pdfcraft layout", () => {
  it("fits the widest page", () => {
    expect(fitZoom(424, pages)).toBeCloseTo((424 - 24) / 300);
    expect(fitZoom(0, pages)).toBe(1);
    expect(fitZoom(500, [])).toBe(1);
    expect(fitZoom(10, pages)).toBeGreaterThan(0);
  });

  it("stacks pages with gaps", () => {
    const l = layoutPages(pages, 2, 10);
    expect(l.tops).toEqual([10, 620, 1230]);
    expect(l.widths).toEqual([400, 400, 600]);
    expect(l.heights).toEqual([600, 600, 400]);
    expect(l.total).toBe(1640);
  });

  it("finds the pages in view, with a margin", () => {
    const l = layoutPages(pages, 1, 10);
    expect(visibleRange(l, 0, 100)).toEqual([0, 0]);
    expect(visibleRange(l, 250, 100)).toEqual([0, 1]);
    expect(visibleRange(l, 0, 100, 400)).toEqual([0, 1]);
    expect(visibleRange(l, 5000, 100)).toBeNull();
    expect(visibleRange({ tops: [], widths: [], heights: [], total: 0 }, 0, 100)).toBeNull();
  });

  it("names the page nearest the middle of the screen", () => {
    const l = layoutPages(pages, 1, 10);
    expect(currentPage(l, 0, 400)).toBe(0);
    expect(currentPage(l, 300, 400)).toBe(1);
    expect(currentPage(l, 700, 400)).toBe(2);
  });

  it("keeps a render under the pixel budget", () => {
    expect(renderScale(1, 2, { w: 200, h: 300 })).toBe(2);
    const s = renderScale(10, 3, { w: 600, h: 800 }, 4_000_000);
    expect(600 * s * (800 * s)).toBeLessThanOrEqual(4_000_001);
    expect(renderScale(0, 1, { w: 1, h: 1 })).toBe(0.1);
  });

  it("picks the smallest block under a tap", () => {
    const boxes: ([number, number, number, number] | null)[] = [[0, 0, 100, 100], [10, 10, 30, 20], null];
    expect(hitBlock(boxes, 15, 15)).toBe(1);
    expect(hitBlock(boxes, 60, 60)).toBe(0);
    expect(hitBlock(boxes, 500, 500)).toBe(-1);
    expect(hitBlock(boxes, 31.5, 15)).toBe(1); // a little slop around a small block
  });
});
