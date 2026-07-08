import { describe, expect, it } from "vitest";
import {
  SESSION_MAX_AGE_MS,
  staleSessionIds,
  staleVersionKeys,
  VERSION_KEY_MAX_AGE_MS,
  versionIdsToDrop,
} from "./retention";

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;

describe("staleSessionIds", () => {
  it("drops sessions past the age limit but never the current one", () => {
    const old = NOW - SESSION_MAX_AGE_MS - DAY;
    const ids = staleSessionIds(
      [
        { id: "current", updatedAt: old },
        { id: "old", updatedAt: old },
        { id: "fresh", updatedAt: NOW - DAY },
      ],
      NOW,
      "current",
    );
    expect(ids).toEqual(["old"]);
  });

  it("keeps only the newest N even when all are fresh", () => {
    const sessions = Array.from({ length: 25 }, (_v, i) => ({ id: `s${i}`, updatedAt: NOW - i * 1000 }));
    const ids = staleSessionIds(sessions, NOW, null);
    expect(ids).toEqual(["s20", "s21", "s22", "s23", "s24"]); // the 5 oldest
  });

  it("age 0 clears everything except the kept session", () => {
    const ids = staleSessionIds(
      [
        { id: "a", updatedAt: NOW },
        { id: "b", updatedAt: NOW },
      ],
      NOW,
      "a",
      0,
    );
    expect(ids).toEqual(["b"]);
  });
});

describe("versionIdsToDrop", () => {
  const v = (id: number, ts: number, label: string) => ({ id, ts, label });

  it("does nothing under the cap", () => {
    expect(versionIdsToDrop([v(1, 1, "Auto"), v(2, 2, "Manual")], 5)).toEqual([]);
  });

  it("sheds oldest Auto/Opened snapshots before deliberate ones", () => {
    const versions = [
      v(1, 100, "Manual"),
      v(2, 200, "Auto"),
      v(3, 300, "Saved"),
      v(4, 400, "Opened"),
      v(5, 500, "Auto"),
    ];
    // cap 3: two must go; the two oldest automatics (Auto@200, Opened@400).
    expect(versionIdsToDrop(versions, 3).sort()).toEqual([2, 4]);
  });

  it("falls back to dropping old deliberate snapshots when automatics run out", () => {
    const versions = [v(1, 100, "Manual"), v(2, 200, "Saved"), v(3, 300, "Auto"), v(4, 400, "Manual")];
    // cap 1: three go; Auto first, then the oldest deliberate ones.
    expect(versionIdsToDrop(versions, 1).sort()).toEqual([1, 2, 3]);
  });
});

describe("staleVersionKeys", () => {
  it("flags only keys whose newest snapshot is past the horizon", () => {
    const keys = staleVersionKeys(
      new Map([
        ["dead", NOW - VERSION_KEY_MAX_AGE_MS - DAY],
        ["alive", NOW - DAY],
      ]),
      NOW,
    );
    expect(keys).toEqual(["dead"]);
  });
});
