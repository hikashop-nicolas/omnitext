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
});
