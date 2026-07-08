import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { xlsxImpl } from "./xlsx.impl";
import type { TableView } from "../core/types";

function makeXlsx(rows: (string | number)[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("xlsx round-trip via the table view", () => {
  it("parses to a grid, edits a cell, and writes back preserving other cells", () => {
    const bytes = makeXlsx([
      ["id", "name"],
      [1, "alice"],
      [2, "bob"],
    ]);
    const model = xlsxImpl.parseBinary!(bytes).model;
    const view = xlsxImpl.toView!(model, "table") as TableView;
    expect(view.rows).toEqual([
      ["id", "name"],
      ["1", "alice"],
      ["2", "bob"],
    ]);

    const edited = xlsxImpl.applyViewEdit!(model, { type: "cell", row: 1, col: 1, value: "ALICE" });
    const out = xlsxImpl.serializeBinary!(edited);
    const reparsed = xlsxImpl.toView!(xlsxImpl.parseBinary!(out).model, "table") as TableView;
    expect(reparsed.rows).toEqual([
      ["id", "name"],
      ["1", "ALICE"],
      ["2", "bob"],
    ]);
  });

  it("row and column structure edits round-trip through write and reparse", () => {
    const model = xlsxImpl.parseBinary!(makeXlsx([
      ["id", "name"],
      [1, "alice"],
    ])).model;
    let m = xlsxImpl.applyViewEdit!(model, { type: "insertRow", at: 1 });
    m = xlsxImpl.applyViewEdit!(m, { type: "cell", row: 1, col: 0, value: "new" });
    m = xlsxImpl.applyViewEdit!(m, { type: "insertCol", at: 1 });
    m = xlsxImpl.applyViewEdit!(m, { type: "deleteRow", at: 2 });
    const reparsed = xlsxImpl.toView!(xlsxImpl.parseBinary!(xlsxImpl.serializeBinary!(m)).model, "table") as TableView;
    expect(reparsed.rows).toEqual([
      ["id", "", "name"],
      ["new", "", ""],
    ]);
    const shrunk = xlsxImpl.applyViewEdit!(m, { type: "deleteCol", at: 1 });
    const view = xlsxImpl.toView!(shrunk, "table") as TableView;
    expect(view.rows).toEqual([
      ["id", "name"],
      ["new", ""],
    ]);
  });
});
