import * as XLSX from "xlsx";
import type {
  FormatModule,
  ParseResult,
  TableView,
  ViewEdit,
  ViewKind,
} from "../core/types";

// Spreadsheet behavior (binary). Reads the first worksheet into a string grid that the
// generic table editor edits, and writes the workbook back to bytes (same book type).
// Cell data round-trips; styles/formulas are not preserved (a documented limitation).

interface SheetModel {
  wb: XLSX.WorkBook;
  sheetName: string;
  rows: string[][];
  bookType: XLSX.BookType;
}

function make(bookType: XLSX.BookType): FormatModule {
  return {
    parse(): ParseResult {
      throw new Error("spreadsheet is a binary format; use parseBinary");
    },
    serialize(): string {
      throw new Error("spreadsheet is a binary format; use serializeBinary");
    },
    parseBinary(bytes): ParseResult {
      const wb = XLSX.read(bytes, { type: "array" });
      const sheetName = wb.SheetNames[0] ?? "Sheet1";
      const ws = wb.Sheets[sheetName];
      const aoa = (ws ? XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: "" }) : []) as unknown[][];
      const rows = aoa.map((r) => r.map((c) => (c == null ? "" : String(c))));
      const model: SheetModel = { wb, sheetName, rows, bookType };
      return { ok: true, model, diagnostics: [] };
    },
    serializeBinary(model): Uint8Array {
      const m = model as SheetModel;
      m.wb.Sheets[m.sheetName] = XLSX.utils.aoa_to_sheet(m.rows);
      if (!m.wb.SheetNames.includes(m.sheetName)) m.wb.SheetNames.push(m.sheetName);
      return new Uint8Array(XLSX.write(m.wb, { type: "array", bookType: m.bookType }) as ArrayBuffer);
    },
    toView(model, view: ViewKind): unknown {
      if (view !== "table") throw new Error(`spreadsheet cannot project to view "${view}"`);
      const out: TableView = { rows: (model as SheetModel).rows };
      return out;
    },
    applyViewEdit(model, edit: ViewEdit): unknown {
      const m = model as SheetModel;
      const rows = m.rows.map((r) => r.slice());
      if (edit.type === "cell") {
        while (rows.length <= edit.row) rows.push([]);
        const row = rows[edit.row]!;
        while (row.length <= edit.col) row.push("");
        row[edit.col] = edit.value;
        return { ...m, rows };
      }
      if (edit.type === "insertRow") {
        const width = rows[Math.min(edit.at, rows.length - 1)]?.length ?? 1;
        rows.splice(Math.min(edit.at, rows.length), 0, Array.from({ length: Math.max(1, width) }, () => ""));
        return { ...m, rows };
      }
      if (edit.type === "deleteRow") {
        if (edit.at >= 0 && edit.at < rows.length) rows.splice(edit.at, 1);
        return { ...m, rows };
      }
      if (edit.type === "insertCol") {
        for (const row of rows) row.splice(Math.min(edit.at, row.length), 0, "");
        return { ...m, rows };
      }
      if (edit.type === "deleteCol") {
        for (const row of rows) if (edit.at < row.length) row.splice(edit.at, 1);
        return { ...m, rows };
      }
      throw new Error(`unsupported spreadsheet view edit "${(edit as ViewEdit).type}"`);
    },
  };
}

export const xlsxImpl = make("xlsx");
export const xlsImpl = make("xls");
