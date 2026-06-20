// CSV region-splice round-trip (the Phase 0 spike / gate).
//
// Goal proven here: byte-exact round-trip of UNTOUCHED rows. We parse CSV into a
// model where every physical row keeps its exact original bytes (raw, including its
// line terminator) alongside the parsed cell values. On serialize, an untouched row
// is emitted verbatim; only edited rows are re-serialized. This is the "span-
// preserving parser + region-splice serializer" the plan's gate requires, and it is
// why we do NOT use PapaParse for this (PapaParse normalizes and discards spans).

export interface CsvRow {
  /** Parsed field values for this row. */
  cells: string[];
  /** Exact original text of this row, including its trailing line terminator. */
  raw: string;
  /** The row's line terminator: "\r\n", "\n", "\r", or "" (last row, no newline). */
  terminator: string;
  /** True once a cell in this row has been edited; controls re-serialization. */
  dirty: boolean;
}

export interface CsvModel {
  rows: CsvRow[];
  delimiter: string;
}

const CR = "\r";
const LF = "\n";
const QUOTE = '"';

/** Parse CSV text into a span-preserving model. */
export function parseCsv(text: string, delimiter = ","): CsvModel {
  const rows: CsvRow[] = [];
  let i = 0;
  let rowStart = 0;
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStart = true; // are we at the first char of a field (so a quote opens it)?

  const pushField = () => {
    cells.push(field);
    field = "";
    fieldStart = true;
  };
  const pushRow = (terminator: string, end: number) => {
    rows.push({ cells, raw: text.slice(rowStart, end), terminator, dirty: false });
    cells = [];
    rowStart = end;
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === QUOTE) {
        if (text[i + 1] === QUOTE) {
          field += QUOTE;
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === QUOTE && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }

    if (ch === CR || ch === LF) {
      let terminator: string;
      if (ch === CR && text[i + 1] === LF) {
        terminator = "\r\n";
        i += 2;
      } else {
        terminator = ch;
        i += 1;
      }
      pushField();
      pushRow(terminator, i);
      continue;
    }

    field += ch;
    fieldStart = false;
    i += 1;
  }

  // Trailing row with no terminator, or any pending field/cells.
  if (rowStart < text.length || field !== "" || cells.length > 0) {
    pushField();
    pushRow("", text.length);
  }

  return { rows, delimiter };
}

/** Quote a field only if it contains the delimiter, a quote, or a line break. */
export function quoteField(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes(QUOTE) ||
    value.includes(LF) ||
    value.includes(CR)
  ) {
    return QUOTE + value.replace(/"/g, '""') + QUOTE;
  }
  return value;
}

/** Serialize the model back to text, emitting untouched rows byte-for-byte. */
export function serializeCsv(model: CsvModel): string {
  let out = "";
  for (const row of model.rows) {
    if (!row.dirty) {
      out += row.raw;
    } else {
      out += row.cells.map((c) => quoteField(c, model.delimiter)).join(model.delimiter);
      out += row.terminator;
    }
  }
  return out;
}

/** Return a new model with one cell edited and that row marked dirty. */
export function editCell(
  model: CsvModel,
  rowIndex: number,
  colIndex: number,
  value: string,
): CsvModel {
  const rows = model.rows.slice();
  const target = rows[rowIndex];
  if (!target) throw new RangeError(`row ${rowIndex} out of range`);
  const cells = target.cells.slice();
  if (colIndex < 0 || colIndex >= cells.length) {
    throw new RangeError(`column ${colIndex} out of range`);
  }
  cells[colIndex] = value;
  rows[rowIndex] = { ...target, cells, dirty: true };
  return { ...model, rows };
}
