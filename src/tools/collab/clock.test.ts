import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockSync, bestOf, sampleOf } from "./clock";

describe("clock samples", () => {
  it("puts the peer's reading halfway through the round trip", () => {
    expect(sampleOf(100, 1060, 120)).toEqual({ offset: 950, rtt: 20 });
  });
  it("trusts the fastest round trip", () => {
    expect(bestOf([{ offset: 900, rtt: 80 }, { offset: 1001, rtt: 4 }, { offset: 1010, rtt: 30 }])).toEqual({ offset: 1001, rtt: 4 });
    expect(bestOf([])).toBeNull();
  });
});

describe("ClockSync between two peers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // B's clock runs 5000 ms ahead of A's; each leg takes `legs[i]` ms.
  function pair(legs: number[]) {
    let leg = 0;
    const nowA = () => Date.now();
    const nowB = () => Date.now() + 5000;
    const deliver = (to: () => ClockSync, from: string) => (payload: Uint8Array) => {
      const ms = legs[leg++ % legs.length];
      setTimeout(() => to().receive(payload, from), ms);
    };
    const toB = deliver(() => b, "A");
    const toA = deliver(() => a, "B");
    const a: ClockSync = new ClockSync({ now: nowA, send: (p) => toB(p) });
    const b: ClockSync = new ClockSync({ now: nowB, send: (p) => toA(p) });
    return { a, b };
  }

  it("finds the offset and converts the peer's times", async () => {
    const { a } = pair([10, 10]);
    let ready = false;
    const track = a.track("B", () => (ready = true));
    await vi.advanceTimersByTimeAsync(30);
    expect(ready).toBe(true);
    expect(a.estimate("B")?.offset).toBeCloseTo(5000);
    expect(a.toLocal("B", 12_000)).toBeCloseTo(7000);
    track.dispose();
    a.dispose();
  });

  it("is not thrown off by one slow leg", async () => {
    // Uneven legs on most exchanges; one quick exchange in the burst.
    const { a } = pair([40, 5, 30, 2, 2, 2, 50, 10]);
    a.track("B");
    await vi.advanceTimersByTimeAsync(1500);
    const e = a.estimate("B")!;
    expect(e.rtt).toBe(4);
    expect(e.offset).toBeCloseTo(5000);
    a.dispose();
  });

  it("knows nothing of a peer it never heard from", () => {
    const a = new ClockSync({ now: () => 0, send: () => {} });
    a.track("B");
    expect(a.toLocal("B", 100)).toBeNull();
    a.dispose();
  });
});
