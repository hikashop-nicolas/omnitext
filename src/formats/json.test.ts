import { describe, it, expect } from "vitest";
import { jsonFormat } from "./json";

const score = (sample: string) => jsonFormat.detect({ sample });

describe("json detect", () => {
  it("claims objects and arrays", () => {
    expect(score('{"a": 1}')).toBeGreaterThan(0);
    expect(score('  [1, 2, {"b": "]"}]\n')).toBeGreaterThan(0);
    // A sample cut off mid-value still looks like JSON.
    expect(score('{"items": [1, 2, 3, ')).toBeGreaterThan(0);
  });

  it("does not claim a kernel log that opens with a bracket (issue #43)", () => {
    expect(score("[    0.000000] Booting Linux on physical CPU 0x0\n[    0.000000] Linux version 6.1\n")).toBe(0);
    expect(score("[INFO] server started\n")).toBe(0);
  });
});
