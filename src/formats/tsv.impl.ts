import type {
  FormatModule,
  ParseResult,
  TableView,
  ViewEdit,
  ViewKind,
} from "../core/types";
import { applyTableEdit, type CsvModel, type CsvTableEdit, parseCsv, serializeCsv } from "./csv/roundtrip";

// TSV reuses the CSV span-preserving round-trip with a tab delimiter, so it gets the
// same byte-exact guarantee and the same generic table editor.
const DELIMITER = "\t";

export const tsvImpl: FormatModule = {
  parse(text): ParseResult {
    return { ok: true, model: parseCsv(text, DELIMITER), diagnostics: [] };
  },
  serialize(model) {
    return serializeCsv(model as CsvModel);
  },
  toView(model, view: ViewKind): unknown {
    if (view !== "table") throw new Error(`tsv cannot project to view "${view}"`);
    const m = model as CsvModel;
    const out: TableView = { rows: m.rows.map((r) => r.cells) };
    return out;
  },
  applyViewEdit(model, edit: ViewEdit): unknown {
    return applyTableEdit(model as CsvModel, edit as CsvTableEdit);
  },
};
