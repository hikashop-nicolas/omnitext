import { describe, expect, it } from "vitest";
import { filterEntries, fuzzyScore } from "./palette";

describe("fuzzyScore", () => {
  it("matches subsequences case-insensitively and rejects non-matches", () => {
    expect(fuzzyScore("sv", "Save")).not.toBeNull();
    expect(fuzzyScore("xyz", "Save")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("prefers word starts and consecutive runs", () => {
    const wordStart = fuzzyScore("hist", "History")!;
    const scattered = fuzzyScore("hsty", "History")!;
    expect(wordStart).toBeGreaterThan(scattered);
  });

  it("folds diacritics", () => {
    expect(fuzzyScore("parametres", "Paramètres")).not.toBeNull();
    expect(fuzzyScore("reglages", "Réglages")).not.toBeNull();
  });
});

describe("filterEntries", () => {
  const entries = [
    { label: "New document" },
    { label: "Open" },
    { label: "Save" },
    { label: "View : Table" },
    { label: "Version history" },
  ];

  it("returns everything for an empty query, in original order", () => {
    expect(filterEntries(entries, "").map((e) => e.label)).toEqual(entries.map((e) => e.label));
  });

  it("ranks the better match first", () => {
    const out = filterEntries(entries, "vi").map((e) => e.label);
    expect(out[0]).toBe("View : Table"); // word-start beats mid-word
    expect(out).toContain("Version history");
  });

  it("drops non-matches", () => {
    expect(filterEntries(entries, "zzz")).toEqual([]);
  });
});
