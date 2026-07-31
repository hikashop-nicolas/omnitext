import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugTally, debug, debugEnabled, refreshDebug } from "./debug";

// Debug logging. The property worth testing is that it is silent and free when off:
// logging that costs something when nobody asked for it does not stay in the code.

// The node test environment has no localStorage; the module reads it defensively, so a
// minimal stand-in is enough and keeps the test honest about which path it exercises.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() {
    return store.size;
  },
} as unknown as Storage;

const setFlags = (value: string | null): void => {
  if (value === null) localStorage.removeItem("omnitext:debug");
  else localStorage.setItem("omnitext:debug", value);
  refreshDebug();
};

describe("debug", () => {
  beforeEach(() => setFlags(null));
  afterEach(() => {
    setFlags(null);
    vi.restoreAllMocks();
  });

  it("is off by default", () => {
    expect(debugEnabled("collab")).toBe(false);
    expect(debugEnabled("wire")).toBe(false);
  });

  it("turns on one area without turning on the others", () => {
    setFlags("collab");
    expect(debugEnabled("collab")).toBe(true);
    expect(debugEnabled("wire")).toBe(false);
  });

  it("takes a list, and ignores spacing and case", () => {
    setFlags(" Collab , WIRE ");
    expect(debugEnabled("collab")).toBe(true);
    expect(debugEnabled("wire")).toBe(true);
  });

  it('turns everything on with "all"', () => {
    setFlags("all");
    expect(debugEnabled("collab")).toBe(true);
    expect(debugEnabled("peers")).toBe(true);
  });

  it("logs nothing when the area is off", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    debug("collab", "should not appear");
    expect(info).not.toHaveBeenCalled();
  });

  it("logs when the area is on", () => {
    setFlags("collab");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    debug("collab", "hello", () => ({ a: 1 }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toContain("collab: hello");
    expect(info.mock.calls[0][1]).toEqual({ a: 1 });
  });

  // The reason detail is a function: serialising every cell change on every keystroke
  // would be a real cost to pay for logging nobody switched on.
  it("does not build the detail when the area is off", () => {
    const detail = vi.fn(() => ({ expensive: true }));
    debug("wire", "quiet", detail);
    expect(detail).not.toHaveBeenCalled();

    setFlags("wire");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    debug("wire", "loud", detail);
    expect(detail).toHaveBeenCalledTimes(1);
  });

  describe("tally", () => {
    it("counts nothing while its area is off", () => {
      const tally = new DebugTally("wire");
      tally.add("in:sync");
      expect(tally.snapshot()).toEqual({});
    });

    it("counts by name once its area is on", () => {
      setFlags("wire");
      const tally = new DebugTally("wire");
      tally.add("in:sync");
      tally.add("in:sync");
      tally.add("in:awareness", 3);
      expect(tally.snapshot()).toEqual({ "in:sync": 2, "in:awareness": 3 });
    });

    it("reports nothing when it has counted nothing", () => {
      setFlags("wire");
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      new DebugTally("wire").report("totals");
      expect(info).not.toHaveBeenCalled();
    });
  });
});
