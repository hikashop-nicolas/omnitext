import { describe, expect, it } from "vitest";
import { tomlImpl } from "./toml.impl";

// The TOML format only ever parses to produce diagnostics: the model is the raw text. So what
// matters here is that it calls a file broken exactly when it IS broken, and the parser's own
// limits do not leak into the editor as errors on valid input.

const errors = (text: string) => tomlImpl.validate!(text, text);

describe("toml validation", () => {
  it("passes valid input, and says nothing about an empty file", () => {
    expect(errors("")).toEqual([]);
    expect(errors('title = "a"\n[owner]\nname = "b"\n')).toEqual([]);
  });

  it("accepts integers past 2^53, which are valid TOML", () => {
    // toml 5 throws on these unless it is asked for BigInt, so without that option a file with
    // an id or a nanosecond timestamp in it would be underlined as an error.
    expect(errors("id = 9223372036854775807")).toEqual([]);
    expect(errors("id = -9223372036854775808")).toEqual([]);
  });

  it("still rejects an integer outside TOML's 64-bit range", () => {
    expect(errors("id = 12345678901234567890").length).toBe(1);
  });

  it("reports a syntax error, and points at where it is", () => {
    // The offending "=" is at offset 4; the diagnostic has to land on it rather than on the
    // whole file, which is what happened while the code looked for a line/column the parser
    // has never set.
    const diags = errors("name = = 1\n");
    expect(diags.length).toBe(1);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[0]!.message).toBeTruthy();
    expect(diags[0]!.from).toBe(7);
    expect(diags[0]!.to).toBeGreaterThan(diags[0]!.from!);
  });

  it("keeps the reported range inside the text", () => {
    // A parser that gives up at the very end reports an offset one past the last character.
    for (const diag of errors("a = ")) {
      expect(diag.from!).toBeLessThanOrEqual("a = ".length);
      expect(diag.to!).toBeLessThanOrEqual("a = ".length);
    }
  });

  it("turns deeply nested input into a diagnostic rather than a crash", () => {
    // This used to overflow the stack (GHSA-82x6-q7mm-w9cf); an editor parses whatever is pasted
    // into it, so the failure has to arrive as an error message.
    const diags = errors(`a = ${"[".repeat(2000)}${"]".repeat(2000)}`);
    expect(diags.length).toBe(1);
  });
});

// Temporary: proves the pull-request check actually fails a bad change. Removed before merge.
describe("ci self-test", () => {
  it("deliberately fails", () => {
    expect(1).toBe(2);
  });
});
