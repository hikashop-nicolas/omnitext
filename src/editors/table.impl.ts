import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
  FormatModule,
  TableView,
  ViewEdit,
} from "../core/types";
import { t } from "../i18n";

// Generic table editor (lazy-loaded). It consumes any format's "table" view adapter:
// it parses text to the format's model, renders an editable grid, reconciles each cell
// edit back through the format (region-splice, so untouched rows stay byte-exact), and
// reports canonical text via the format's serialize. Row/column structure edits go
// through the same ViewEdit channel and rebuild the grid. No CSV-specific code here.

const STYLE_ID = "omnitext-table-editor-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-table-outer { height: 100%; display: flex; flex-direction: column; background: var(--canvas); }
    .ot-table-bar {
      display: flex; gap: 4px; padding: 4px 8px; flex: none;
      background: var(--chrome); border-bottom: 1px solid var(--border);
    }
    .ot-table-bar button {
      border: 1px solid var(--border); border-radius: 4px; background: var(--canvas);
      color: var(--text); font: 12px/1.6 system-ui, sans-serif; padding: 1px 8px; cursor: pointer;
    }
    .ot-table-bar button:hover { border-color: var(--accent); }
    .ot-table-bar .ot-table-sep { width: 1px; background: var(--border); margin: 2px 4px; }
    .ot-table-wrap { flex: 1; overflow: auto; }
    table.ot-table {
      border-collapse: collapse;
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .ot-table td { border: 1px solid var(--border); padding: 0; }
    .ot-table .ot-rownum {
      position: sticky; left: 0; z-index: 1;
      background: var(--chrome); color: var(--muted);
      text-align: right; padding: 0 8px; user-select: none;
      font-variant-numeric: tabular-nums;
    }
    .ot-table input {
      border: 0; background: transparent; color: var(--text);
      font: inherit; padding: 4px 9px; min-width: 90px; width: 100%; outline: none;
    }
    .ot-table input:focus { box-shadow: inset 0 0 0 2px var(--accent); }
    .ot-table tr:first-child input { font-weight: 600; }
  `;
  document.head.appendChild(s);
}

class TableInstance implements EditorInstance {
  private format: FormatModule | null = null;
  private model: unknown = null;
  private binary = false;
  private notifyChange: () => void = () => {};
  private outer: HTMLElement | null = null;
  private grid: HTMLElement | null = null;
  private sel: { row: number; col: number } | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.format = ctx.format;
    this.binary = ctx.binary;
    this.notifyChange = ctx.onChange;

    if (!this.format?.toView || !this.format.applyViewEdit) {
      container.textContent = t("tableEditor.needsFormat");
      return;
    }
    this.model = ctx.model; // host pre-parsed (from text or bytes)

    const outer = document.createElement("div");
    outer.className = "ot-table-outer";
    outer.appendChild(this.buildBar());
    const wrap = document.createElement("div");
    wrap.className = "ot-table-wrap";
    outer.appendChild(wrap);
    container.appendChild(outer);
    this.outer = outer;
    this.grid = wrap;
    this.render();
  }

  private buildBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "ot-table-bar";
    const btn = (label: string, title: string, fn: () => void): HTMLElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      // mousedown would blur the focused cell and lose the selection
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", fn);
      return b;
    };
    const sep = (): HTMLElement => {
      const s = document.createElement("div");
      s.className = "ot-table-sep";
      return s;
    };
    bar.append(
      btn(t("tableEditor.rowAboveLabel"), t("tableEditor.insertRowAbove"), () => this.structure("insertRow", 0)),
      btn(t("tableEditor.rowBelowLabel"), t("tableEditor.insertRowBelow"), () => this.structure("insertRow", 1)),
      btn(t("tableEditor.deleteRowLabel"), t("tableEditor.deleteRow"), () => this.structure("deleteRow", 0)),
      sep(),
      btn(t("tableEditor.colLeftLabel"), t("tableEditor.insertColLeft"), () => this.structure("insertCol", 0)),
      btn(t("tableEditor.colRightLabel"), t("tableEditor.insertColRight"), () => this.structure("insertCol", 1)),
      btn(t("tableEditor.deleteColLabel"), t("tableEditor.deleteCol"), () => this.structure("deleteCol", 0)),
    );
    return bar;
  }

  private view(): TableView {
    return this.format!.toView!(this.model, "table") as TableView;
  }

  private render(): void {
    if (!this.grid) return;
    this.grid.textContent = "";
    const table = document.createElement("table");
    table.className = "ot-table";
    this.view().rows.forEach((cells, r) => {
      const tr = document.createElement("tr");
      const num = document.createElement("td");
      num.className = "ot-rownum";
      num.textContent = String(r + 1);
      tr.appendChild(num);
      cells.forEach((value, c) => {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.type = "text";
        input.value = value;
        input.addEventListener("input", () => this.edit(r, c, input.value));
        input.addEventListener("focus", () => {
          this.sel = { row: r, col: c };
        });
        td.appendChild(input);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    this.grid.appendChild(table);
  }

  private edit(row: number, col: number, value: string): void {
    if (!this.format?.applyViewEdit) return;
    this.model = this.format.applyViewEdit(this.model, { type: "cell", row, col, value });
    this.notifyChange();
  }

  /** The cell owning the focused input, read from the DOM (survives missed focus events). */
  private selFromDom(): { row: number; col: number } | null {
    const inp = document.activeElement;
    if (!(inp instanceof HTMLInputElement) || !this.grid?.contains(inp)) return null;
    const tr = inp.closest("tr");
    if (!tr || !tr.parentElement) return null;
    const row = Array.from(tr.parentElement.children).indexOf(tr);
    const col = Array.from(tr.querySelectorAll("input")).indexOf(inp);
    return row >= 0 && col >= 0 ? { row, col } : null;
  }

  /** A row/column insert or delete relative to the selected cell (offset 1 = after). */
  private structure(op: "insertRow" | "deleteRow" | "insertCol" | "deleteCol", offset: 0 | 1): void {
    if (!this.format?.applyViewEdit) return;
    const rows = this.view().rows;
    const rowCount = rows.length;
    const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const sel = this.selFromDom() ?? this.sel ?? { row: rowCount - 1, col: colCount - 1 };
    const isRow = op === "insertRow" || op === "deleteRow";
    const base = isRow ? Math.max(0, Math.min(sel.row, rowCount - 1)) : Math.max(0, Math.min(sel.col, colCount - 1));
    let at = op.startsWith("insert") ? base + offset : base;
    if (op === "insertRow" && rowCount === 0) at = 0;
    if (op === "insertCol" && colCount === 0) at = 0;
    if ((op === "deleteRow" && rowCount === 0) || (op === "deleteCol" && colCount === 0)) return;
    this.model = this.format.applyViewEdit(this.model, { type: op, at } as ViewEdit);
    this.notifyChange();
    this.render();
    // Put the caret on a sensible neighbour so keyboard flow continues.
    const after = this.view().rows;
    const fr = Math.max(0, Math.min(isRow ? at : sel.row, after.length - 1));
    const fc = Math.max(0, Math.min(isRow ? sel.col : at, (after[fr]?.length ?? 1) - 1));
    const input = this.grid?.querySelectorAll("tr")[fr]?.querySelectorAll("input")[fc];
    input?.focus();
  }

  getText(): string {
    return this.format && !this.binary ? this.format.serialize(this.model) : "";
  }

  getBytes(): Uint8Array | undefined {
    return this.binary && this.format?.serializeBinary
      ? this.format.serializeBinary(this.model)
      : undefined;
  }

  selection(): unknown {
    return this.sel;
  }

  focus(): void {
    this.grid?.querySelector("input")?.focus();
  }

  dispose(): void {
    this.outer?.remove();
    this.outer = null;
    this.grid = null;
  }
}

export const tableEditor: EditorModule = {
  create: () => new TableInstance(),
};
