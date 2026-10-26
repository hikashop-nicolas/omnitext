import { describe, expect, it } from "vitest";
import { boxBetween, currentPage, fitPageZoom, fitZoom, hitBlock, layoutPages, newTextBox, renderScale, resizeBox, visibleRange } from "./pdfcraft-layout";

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

  it("fits a whole page, by whichever side is tighter", () => {
    expect(fitPageZoom(424, 900, { w: 200, h: 300 })).toBeCloseTo((424 - 24) / 200); // width is the limit
    expect(fitPageZoom(1000, 424, { w: 200, h: 300 })).toBeCloseTo((424 - 24) / 300); // height is the limit
    expect(fitPageZoom(0, 500, { w: 200, h: 300 })).toBe(1);
  });

  it("resizes by a handle without inverting or leaving the page", () => {
    const page = { w: 200, h: 300 };
    expect(resizeBox([20, 20, 100, 80], "se", 30, 10)).toEqual([20, 20, 130, 90]);
    expect(resizeBox([20, 20, 100, 80], "nw", 10, 5)).toEqual([30, 25, 100, 80]);
    expect(resizeBox([20, 20, 100, 80], "e", 40, 99)).toEqual([20, 20, 140, 80]);
    expect(resizeBox([20, 20, 100, 80], "se", -200, -200)).toEqual([20, 20, 32, 32]); // kept at the minimum
    expect(resizeBox([20, 20, 100, 80], "se", 500, 500, 12, page)).toEqual([20, 20, 200, 300]);
    expect(resizeBox([20, 20, 100, 80], "nw", -500, -500, 12, page)).toEqual([0, 0, 100, 80]);
  });

  it("draws a box between two corners in any order", () => {
    expect(boxBetween([50, 60], [10, 20], { w: 200, h: 300 })).toEqual([10, 20, 50, 60]);
    expect(boxBetween([-5, 400], [250, 10], { w: 200, h: 300 })).toEqual([0, 10, 200, 300]);
  });

  it("puts a new text box where the tap was, inside the page", () => {
    const page = { w: 200, h: 300 };
    expect(newTextBox(10, 100, page)).toEqual([10, 100, 170, 136]);
    expect(newTextBox(50, 100, page)).toEqual([32, 100, 192, 136]); // would stick out on the right: pushed back
    expect(newTextBox(190, 295, page)).toEqual([32, 256, 192, 292]); // pushed back inside
    expect(newTextBox(-10, -10, page)).toEqual([8, 8, 168, 44]);
  });
});
