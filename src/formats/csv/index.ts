import type {
  FormatModule,
  ParseResult,
  TableView,
  ViewEdit,
  ViewKind,
} from "../../core/types";
import { type CsvModel, editCell, parseCsv, serializeCsv } from "./roundtrip";

// CSV is a structured format: its model is the span-preserving CsvModel (see
// roundtrip.ts). It has no native editor; it resolves to a generic table editor when
// one is registered (via the "table" view adapter), and otherwise to the text
// fallback. Either way, serialize keeps untouched rows byte-for-byte.

export const csvFormat: FormatModule = {
  manifest: {
    kind: "format",
    id: "csv",
    extensions: [".csv"],
    mimeTypes: ["text/csv"],
    viewAdapters: ["table"],
  },
  detect({ sample }) {
    const firstLine = sample.split(/\r\n|\r|\n/, 1)[0] ?? "";
    return firstLine.includes(",") ? 0.4 : 0;
  },
  parse(text): ParseResult {
    return { ok: true, model: parseCsv(text), diagnostics: [] };
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
    if (edit.type === "cell") {
      return editCell(model as CsvModel, edit.row, edit.col, edit.value);
    }
    throw new Error(`unsupported csv view edit "${edit.type}"`);
  },
};
