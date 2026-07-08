import type {
  FormatModule,
  ParseResult,
  TableView,
  ViewEdit,
  ViewKind,
} from "../../core/types";
import { applyTableEdit, type CsvModel, type CsvTableEdit, parseCsv, serializeCsv } from "./roundtrip";
import { sniffDelimiter } from "./sniff";

// CSV behavior (lazy-loaded). Its model is the span-preserving CsvModel (roundtrip.ts),
// so serialize keeps untouched rows byte-for-byte. It exposes a "table" view adapter
// for the generic table editor; the text fallback editor edits the raw text directly.
// The delimiter is sniffed per file (comma, semicolon, tab, pipe) and kept on the
// model, so a semicolon CSV opens as a grid and saves with semicolons.

export const csvImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: parseCsv(text, sniffDelimiter(text)), diagnostics: [] };
  },
  serialize(model) {
    return serializeCsv(model as CsvModel);
  },
  toView(model, view: ViewKind): unknown {
    if (view !== "table") throw new Error(`csv cannot project to view "${view}"`);
    const m = model as CsvModel;
    const out: TableView = { rows: m.rows.map((r) => r.cells) };
    return out;
  },
  applyViewEdit(model, edit: ViewEdit): unknown {
    return applyTableEdit(model as CsvModel, edit as CsvTableEdit);
  },
};
