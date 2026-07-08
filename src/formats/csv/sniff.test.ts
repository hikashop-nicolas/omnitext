import { describe, it, expect } from "vitest";
import { sniffConfidence, sniffDelimiter } from "./sniff";
import { parseCsv, serializeCsv } from "./roundtrip";

describe("sniffDelimiter", () => {
  it("defaults to comma on empty or undelimited text", () => {
    expect(sniffDelimiter("")).toBe(",");
    expect(sniffDelimiter("hello world\nsecond line\n")).toBe(",");
  });

  it("picks the comma for a plain CSV", () => {
    expect(sniffDelimiter("a,b,c\nd,e,f\n")).toBe(",");
  });

  it("picks the semicolon for a French-Excel CSV", () => {
    expect(sniffDelimiter("id;nom;note\n1;alice;bien\n2;bob;super\n")).toBe(";");
  });

  it("prefers the consistent delimiter when commas appear inside fields", () => {
    expect(sniffDelimiter("name;note\nalice;hello, world\nbob;x\n")).toBe(";");
  });

  it("ignores delimiters inside quoted fields", () => {
    expect(sniffDelimiter('"a,b";c\n"d,e,f";g\n')).toBe(";");
  });

  it("detects tab and pipe", () => {
    expect(sniffDelimiter("a\tb\nc\td\n")).toBe("\t");
    expect(sniffDelimiter("a|b|c\nd|e|f\n")).toBe("|");
  });

  it("ties break toward the comma", () => {
    expect(sniffDelimiter("a,b;c\nd,e;f\n")).toBe(",");
  });

  it("single line still sniffs", () => {
    expect(sniffDelimiter("a;b;c")).toBe(";");
  });
});

describe("semicolon CSV end to end", () => {
  it("parses into columns and round-trips byte-exact", () => {
    const text = "id;nom\n1;alice\n2;bob\n";
    const m = parseCsv(text, sniffDelimiter(text));
    expect(m.rows[0]!.cells).toEqual(["id", "nom"]);
    expect(m.delimiter).toBe(";");
    expect(serializeCsv(m)).toBe(text);
  });
});

describe("sniffConfidence (content detection for extension-less files)", () => {
  it("is confident on a consistent multi-column CSV", () => {
    expect(sniffConfidence("a,b,c\nd,e,f\ng,h,i\n")).toBe(0.5);
    expect(sniffConfidence("a;b;c\nd;e;f\n")).toBe(0.5);
  });

  it("rejects prose containing commas", () => {
    expect(sniffConfidence("Hello, this is prose. It goes on and on.\n")).toBe(0);
    expect(
      sniffConfidence(
        "Dear team, please find the report attached.\n" +
          "It covers March, April and May, plus a summary.\n" +
          "Thanks for reading.\n",
      ),
    ).toBe(0);
  });

  it("rejects a single line (the old false-positive trigger)", () => {
    expect(sniffConfidence("word one, word two")).toBe(0);
  });

  it("gives weak confidence to consistent two-column data with 3+ lines", () => {
    expect(sniffConfidence("a,b\nc,d\ne,f\n")).toBe(0.3);
  });
});
