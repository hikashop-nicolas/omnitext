import { tableFromIPC } from "apache-arrow";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only viewer for Apache Arrow IPC / Feather files (apache-arrow): renders the first
// rows into a grid with column names and types. Read entirely in-browser.

const STYLE_ID = "omnitext-records-style";
const ROW_LIMIT = 1000;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-records { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--canvas);
      color:var(--text); }
    .ot-records-head { flex:0 0 auto; padding:8px 12px; border-bottom:1px solid var(--border);
      background:var(--chrome); font:12px system-ui, sans-serif; color:var(--muted); }
    .ot-records-grid { flex:1 1 auto; overflow:auto; }
    .ot-records-grid table { border-collapse:collapse; font:12px/1.4 ui-monospace, monospace; }
    .ot-records-grid th, .ot-records-grid td { border:1px solid var(--border); padding:3px 8px; text-align:left;
      white-space:nowrap; max-width:360px; overflow:hidden; text-overflow:ellipsis; }
    .ot-records-grid th { position:sticky; top:0; background:var(--chrome); font-weight:600; z-index:1; }
    .ot-records-grid th small { color:var(--muted); font-weight:400; margin-left:6px; }
    .ot-records-grid td.is-null { color:var(--muted); font-style:italic; }
    .ot-records-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `⟨${v.length} bytes⟩`;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    } catch {
      return String(v);
    }
  }
  return String(v);
}

interface Grid {
  columns: { name: string; type?: string }[];
  rows: Record<string, unknown>[];
  total: number;
}

function readArrow(bytes: Uint8Array): Grid {
  const table = tableFromIPC(bytes);
  const columns = table.schema.fields.map((f) => ({ name: f.name, type: String(f.type).toLowerCase() }));
  const rows: Record<string, unknown>[] = [];
  const n = Math.min(table.numRows, ROW_LIMIT);
  for (let i = 0; i < n; i++) {
    rows.push(table.get(i)?.toJSON() ?? {});
  }
  return { columns, rows, total: table.numRows };
}

class RecordsInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-records";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-records-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, bytes: Uint8Array): Promise<void> {
    try {
      const grid = readArrow(bytes);
      root.textContent = "";

      const head = document.createElement("div");
      head.className = "ot-records-head";
      head.textContent = `${grid.total.toLocaleString()} row${grid.total === 1 ? "" : "s"} · ${grid.columns.length} columns${
        grid.total > grid.rows.length ? ` · showing first ${grid.rows.length}` : ""
      }`;
      root.appendChild(head);

      const gridEl = document.createElement("div");
      gridEl.className = "ot-records-grid";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      for (const c of grid.columns) {
        const th = document.createElement("th");
        th.textContent = c.name;
        if (c.type) {
          const small = document.createElement("small");
          small.textContent = c.type;
          th.appendChild(small);
        }
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      const tbody = document.createElement("tbody");
      for (const row of grid.rows) {
        const tr = document.createElement("tr");
        for (const c of grid.columns) {
          const td = document.createElement("td");
          const v = row[c.name];
          if (v == null) {
            td.textContent = "NULL";
            td.className = "is-null";
          } else {
            td.textContent = cellText(v);
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      gridEl.appendChild(table);
      root.appendChild(gridEl);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-records-msg";
      m.textContent = "This file could not be read:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
    }
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    this.root?.remove();
    this.root = null;
  }
}

export const recordsViewer: EditorModule = {
  create: () => new RecordsInstance(),
};
