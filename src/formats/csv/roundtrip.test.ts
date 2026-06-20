import { describe, it, expect } from "vitest";
import { parseCsv, serializeCsv, editCell } from "./roundtrip";

/** Full unedited round-trip must be byte-identical. */
function assertByteExact(text: string, delimiter = ",") {
  expect(serializeCsv(parseCsv(text, delimiter))).toBe(text);
}

describe("CSV byte-exact round-trip (unedited)", () => {
  it("simple LF", () => assertByteExact("a,b,c\nd,e,f\n"));
  it("no trailing newline", () => assertByteExact("a,b,c\nd,e,f"));
  it("CRLF", () => assertByteExact("a,b\r\nc,d\r\n"));
  it("mixed CRLF and LF terminators", () => assertByteExact("a,b\r\nc,d\ne,f\r\n"));
  it("bare CR terminator", () => assertByteExact("a,b\rc,d\r"));
  it("empty input", () => assertByteExact(""));
  it("single field no newline", () => assertByteExact("hello"));
  it("empty fields", () => assertByteExact("a,,c\n,,\n"));
  it("empty lines preserved", () => assertByteExact("a\n\nb\n"));
  it("quoted field with comma", () => assertByteExact('"a,b",c\n'));
  it("quoted field with embedded newline", () => assertByteExact('"line1\nline2",x\ny,z\n'));
  it("quoted field with embedded CRLF", () => assertByteExact('"a\r\nb",c\r\n'));
  it("escaped quotes inside quoted field", () => assertByteExact('"she said ""hi""",ok\n'));
  it("leading UTF-8 BOM preserved", () => assertByteExact("﻿a,b\nc,d\n"));
  it("unusual but exact whitespace inside fields", () => assertByteExact("  a , b  ,c\n"));
  it("semicolon delimiter", () => assertByteExact("a;b;c\nd;e;f\n", ";"));
  it("trailing delimiter (empty last field)", () => assertByteExact("a,b,\n"));
});

describe("parse correctness", () => {
  it("parses cells, raw, and terminator per row", () => {
    const m = parseCsv("a,b\r\nc,d\n");
    expect(m.rows.length).toBe(2);
    expect(m.rows[0]!.cells).toEqual(["a", "b"]);
    expect(m.rows[0]!.raw).toBe("a,b\r\n");
    expect(m.rows[0]!.terminator).toBe("\r\n");
    expect(m.rows[1]!.cells).toEqual(["c", "d"]);
    expect(m.rows[1]!.terminator).toBe("\n");
  });

  it("unquotes escaped quotes and embedded separators", () => {
    const m = parseCsv('"a,b","c""d","e\nf"\n');
    expect(m.rows[0]!.cells).toEqual(["a,b", 'c"d', "e\nf"]);
  });
});

describe("region-splice: editing only reformats the edited row", () => {
  it("untouched rows stay byte-identical after an edit", () => {
    // Row 1 uses CRLF and odd spacing we must NOT disturb.
    const text = "id, name ,note\r\n1,alice,hello\r\n2,bob,world\r\n";
    const m = parseCsv(text);
    const edited = editCell(m, 1, 1, "ALICE");
    const out = serializeCsv(edited);

    const originalLines = text.split("\r\n");
    const outLines = out.split("\r\n");
    // Header (row 0) and row 2 must be byte-identical to the originals.
    expect(outLines[0]).toBe(originalLines[0]); // "id, name ,note"
    expect(outLines[2]).toBe(originalLines[2]); // "2,bob,world"
    // The edited row reflects the new value and keeps its CRLF terminator.
    expect(out).toContain("1,ALICE,hello\r\n");
  });

  it("edit that introduces a comma gets quoted, others untouched", () => {
    const text = "a,b\nc,d\n";
    const out = serializeCsv(editCell(parseCsv(text), 0, 1, "x,y"));
    expect(out).toBe('a,"x,y"\nc,d\n');
  });

  it("a value with a quote is escaped on the edited row only", () => {
    const text = "a,b\nc,d\n";
    const out = serializeCsv(editCell(parseCsv(text), 1, 0, 'he"llo'));
    expect(out).toBe('a,b\n"he""llo",d\n');
  });

  it("editing preserves a missing trailing newline", () => {
    const text = "a,b\nc,d"; // no final newline
    const out = serializeCsv(editCell(parseCsv(text), 1, 1, "D"));
    expect(out).toBe("a,b\nc,D");
  });
});
