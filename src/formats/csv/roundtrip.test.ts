import { describe, it, expect } from "vitest";
import { applyTableEdit, deleteCol, deleteRow, editCell, insertCol, insertRow, parseCsv, serializeCsv } from "./roundtrip";

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

describe("row operations", () => {
  it("inserts an empty row mid-file, untouched rows byte-exact", () => {
    const text = "id, name \r\n1,alice\r\n2,bob\r\n";
    const out = serializeCsv(insertRow(parseCsv(text), 1));
    expect(out).toBe("id, name \r\n,\r\n1,alice\r\n2,bob\r\n");
  });

  it("inserting at the top matches the header width", () => {
    const out = serializeCsv(insertRow(parseCsv("a,b,c\n"), 0));
    expect(out).toBe(",,\na,b,c\n");
  });

  it("appending after a final row without newline gives it one first", () => {
    const out = serializeCsv(insertRow(parseCsv("a,b\nc,d"), 2));
    expect(out).toBe("a,b\nc,d\n,");
  });

  it("appending to a file with trailing newline keeps the shape", () => {
    const out = serializeCsv(insertRow(parseCsv("a,b\n"), 1));
    expect(out).toBe("a,b\n,\n");
  });

  it("inserting into an empty file makes a single empty row", () => {
    const m = insertRow(parseCsv(""), 0);
    expect(m.rows.length).toBe(1);
    expect(m.rows[0]!.cells).toEqual([""]);
    expect(serializeCsv(m)).toBe("\n");
  });

  it("deletes a row, other rows byte-exact", () => {
    const text = 'a, x ,c\r\n"1,5",e,f\ng,h,i\r\n';
    const out = serializeCsv(deleteRow(parseCsv(text), 1));
    expect(out).toBe("a, x ,c\r\ng,h,i\r\n");
  });

  it("row indexes out of range throw", () => {
    const m = parseCsv("a\n");
    expect(() => insertRow(m, 5)).toThrow(RangeError);
    expect(() => deleteRow(m, 1)).toThrow(RangeError);
  });
});

describe("column operations (whole-file reformat)", () => {
  it("inserts an empty column mid-table", () => {
    const out = serializeCsv(insertCol(parseCsv("a,b\nc,d\n"), 1));
    expect(out).toBe("a,,b\nc,,d\n");
  });

  it("inserting past a short row appends at its end", () => {
    const out = serializeCsv(insertCol(parseCsv("a,b,c\nd\n"), 2));
    expect(out).toBe("a,b,,c\nd,\n");
  });

  it("deletes a column; rows without it are untouched", () => {
    const out = serializeCsv(deleteCol(parseCsv("a,b,c\nd\ne,f,g\n"), 1));
    expect(out).toBe("a,c\nd\ne,g\n");
  });

  it("deleting the only column leaves empty rows, not zero-field rows", () => {
    const out = serializeCsv(deleteCol(parseCsv("a\nb\n"), 0));
    expect(out).toBe("\n\n");
  });

  it("quoting still applies to values that need it after a column shift", () => {
    const out = serializeCsv(insertCol(parseCsv('"x,y",b\n'), 0));
    expect(out).toBe(',"x,y",b\n');
  });

  it("semicolon files keep their delimiter through structure edits", () => {
    const out = serializeCsv(insertCol(parseCsv("a;b\nc;d\n", ";"), 1));
    expect(out).toBe("a;;b\nc;;d\n");
  });
});

describe("applyTableEdit dispatch", () => {
  it("routes each edit type", () => {
    let m = parseCsv("a,b\n");
    m = applyTableEdit(m, { type: "insertRow", at: 1 });
    m = applyTableEdit(m, { type: "cell", row: 1, col: 0, value: "z" });
    m = applyTableEdit(m, { type: "insertCol", at: 2 });
    m = applyTableEdit(m, { type: "deleteCol", at: 1 });
    m = applyTableEdit(m, { type: "deleteRow", at: 0 });
    expect(serializeCsv(m)).toBe("z,\n");
  });
});
