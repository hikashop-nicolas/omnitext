import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
  FormatModule,
  TableView,
} from "../core/types";

// Generic table editor (lazy-loaded). It consumes any format's "table" view adapter:
// it parses text to the format's model, renders an editable grid, reconciles each cell
// edit back through the format (region-splice, so untouched rows stay byte-exact), and
// reports canonical text via the format's serialize. It contains no CSV-specific code.

const STYLE_ID = "omnitext-table-editor-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-table-wrap { height: 100%; overflow: auto; background: var(--canvas); }
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
  private wrap: HTMLElement | null = null;
  private sel: { row: number; col: number } | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.format = ctx.format;
    this.binary = ctx.binary;
    this.notifyChange = ctx.onChange;

    if (!this.format?.toView || !this.format.applyViewEdit) {
      container.textContent = "The table editor needs a format with a table view.";
      return;
    }
    this.model = ctx.model; // host pre-parsed (from text or bytes)
    const view = this.format.toView(this.model, "table") as TableView;

    const wrap = document.createElement("div");
    wrap.className = "ot-table-wrap";
    const table = document.createElement("table");
    table.className = "ot-table";

    view.rows.forEach((cells, r) => {
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

    wrap.appendChild(table);
    container.appendChild(wrap);
    this.wrap = wrap;
  }

  private edit(row: number, col: number, value: string): void {
    if (!this.format?.applyViewEdit) return;
    this.model = this.format.applyViewEdit(this.model, { type: "cell", row, col, value });
    this.notifyChange();
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
    this.wrap?.querySelector("input")?.focus();
  }

  dispose(): void {
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const tableEditor: EditorModule = {
  create: () => new TableInstance(),
};
