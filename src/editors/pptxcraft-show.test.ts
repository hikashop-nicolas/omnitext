import { describe, expect, it } from "vitest";
import type { DeckSession } from "craftbridge/deck";
import { ShowRunner, type ShowHost } from "./pptxcraft-show";

// The show's order of slides and clicks, with no engine and nothing to draw on.
function host(o: Partial<ShowHost> & { steps?: Record<number, number> } = {}): { h: ShowHost; seen: number[] } {
  const seen: number[] = [];
  const steps = o.steps ?? {};
  const session = {
    showInfo: async (i: number) => ({ steps: steps[i] ?? 0, auto: [], durations: Array(steps[i] ?? 0).fill(0) }),
  } as unknown as DeckSession;
  const h: ShowHost = {
    session,
    call: async (fn) => fn(),
    total: 5,
    slideW: 960,
    slideH: 540,
    surfaces: () => [],
    transition: async () => null,
    onSlide: (i) => seen.push(i),
    onLeave: () => undefined,
    ...o,
  };
  return { h, seen };
}

describe("the slide show", () => {
  it("steps through the slides and stops at the ends", async () => {
    const { h } = host();
    const r = new ShowRunner(h);
    await r.goto(0);
    await r.next();
    await r.next();
    expect(r.index).toBe(2);
    await r.prev();
    expect(r.index).toBe(1);
    await r.goto(4);
    await r.next();
    expect(r.index).toBe(4);
  });

  it("skips hidden slides", async () => {
    const { h } = host({ hidden: [false, true, true, false, false] });
    const r = new ShowRunner(h);
    await r.goto(0);
    await r.next();
    expect(r.index).toBe(3);
    await r.prev();
    expect(r.index).toBe(0);
  });

  it("plays the animation steps of a slide before moving on", async () => {
    const { h } = host({ steps: { 0: 2 } });
    const r = new ShowRunner(h);
    await r.goto(0);
    expect(r.steps).toBe(2);
    await r.next();
    expect(r.index).toBe(0);
    expect(r.step).toBe(1);
    await r.next();
    expect(r.step).toBe(2);
    await r.next();
    expect(r.index).toBe(1);
  });

  it("loops back to the first slide when asked to", async () => {
    const { h } = host({ loop: true });
    const r = new ShowRunner(h);
    await r.goto(4);
    await r.next();
    expect(r.index).toBe(0);
  });

  it("keeps to a range and shows the first slide of it", async () => {
    const { h } = host({ range: [1, 3] });
    const r = new ShowRunner(h);
    expect(r.first()).toBe(1);
    await r.goto(3);
    await r.next();
    expect(r.index).toBe(3);
  });

  it("plays a custom show in its own order", async () => {
    const { h } = host({ order: [3, 0, 2] });
    const r = new ShowRunner(h);
    await r.goto(r.first());
    expect(r.index).toBe(3);
    await r.next();
    expect(r.index).toBe(0);
    await r.next();
    await r.next();
    expect(r.index).toBe(2);
    await r.prev();
    expect(r.index).toBe(0);
  });

  it("starts a slide built when it has no animation to play", async () => {
    const { h } = host({ noAnimation: true, steps: { 0: 3 } });
    const r = new ShowRunner(h);
    await r.goto(0);
    expect(r.step).toBe(3);
  });
});
