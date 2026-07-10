import initSqlJs, { type Database, type QueryExecResult } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only SQLite viewer built on sql.js (SQLite compiled to WASM). Lists the tables,
// shows rows of the selected one, and runs ad-hoc read queries. The database lives in
// memory only; nothing is written back.

const STYLE_ID = "omnitext-sqlite-style";
const ROW_LIMIT = 500;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-sqlite { height:100%; display:flex; overflow:hidden; background:var(--canvas); color:var(--text); }
    .ot-sqlite-side { flex:0 0 200px; border-right:1px solid var(--border); background:var(--chrome);
      display:flex; flex-direction:column; overflow:hidden; }
    .ot-sqlite-side h3 { font:600 11px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.04em;
      color:var(--muted); margin:0; padding:10px 12px 6px; }
    .ot-sqlite-tables { flex:1 1 auto; overflow:auto; padding-bottom:8px; }
    .ot-sqlite-table { display:block; width:100%; text-align:left; border:0; background:none; cursor:pointer;
      font:13px system-ui, sans-serif; color:var(--text); padding:5px 12px; }
    .ot-sqlite-table:hover { background:var(--surface-hover, var(--surface)); }
    .ot-sqlite-table.is-active { background:var(--accent); color:#fff; }
    .ot-sqlite-table small { color:var(--muted); margin-left:4px; }
    .ot-sqlite-table.is-active small { color:#fff; opacity:.8; }
    .ot-sqlite-main { flex:1 1 auto; display:flex; flex-direction:column; overflow:hidden; }
    .ot-sqlite-query { display:flex; gap:8px; padding:8px; border-bottom:1px solid var(--border); }
    .ot-sqlite-query textarea { flex:1 1 auto; resize:vertical; min-height:34px; font:12px/1.4 ui-monospace,
      monospace; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--surface);
      color:var(--text); }
    .ot-sqlite-run { flex:0 0 auto; align-self:flex-start; padding:7px 14px; border:1px solid var(--border);
      border-radius:4px; background:var(--accent); color:#fff; cursor:pointer; font:600 13px system-ui; }
    .ot-sqlite-grid { flex:1 1 auto; overflow:auto; }
    .ot-sqlite-grid table { border-collapse:collapse; font:12px/1.4 ui-monospace, monospace; }
    .ot-sqlite-grid th, .ot-sqlite-grid td { border:1px solid var(--border); padding:3px 8px; text-align:left;
      white-space:nowrap; max-width:340px; overflow:hidden; text-overflow:ellipsis; }
    .ot-sqlite-grid th { position:sticky; top:0; background:var(--chrome); font-weight:600; z-index:1; }
    .ot-sqlite-grid td.is-null { color:var(--muted); font-style:italic; }
    .ot-sqlite-note { padding:8px 12px; color:var(--muted); font:12px system-ui, sans-serif; }
    .ot-sqlite-err { padding:8px 12px; color:#e5534b; font:12px/1.4 ui-monospace, monospace; white-space:pre-wrap; }
    .ot-sqlite-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

let sqlStatic: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;
function loadSql() {
  if (!sqlStatic) sqlStatic = initSqlJs({ locateFile: () => wasmUrl });
  return sqlStatic;
}

class SqliteInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private db: Database | null = null;
  private grid: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private activeBtn: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-sqlite";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-sqlite-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, bytes: Uint8Array): Promise<void> {
    try {
      const SQL = await loadSql();
      this.db = new SQL.Database(bytes);
      const tables = this.db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      const tableNames = tables[0]?.values.map((r) => String(r[0])) ?? [];
      root.textContent = "";

      const side = document.createElement("div");
      side.className = "ot-sqlite-side";
      const h = document.createElement("h3");
      h.textContent = `Tables (${tableNames.length})`;
      const listEl = document.createElement("div");
      listEl.className = "ot-sqlite-tables";
      side.append(h, listEl);

      const main = document.createElement("div");
      main.className = "ot-sqlite-main";
      const qbar = document.createElement("div");
      qbar.className = "ot-sqlite-query";
      const ta = document.createElement("textarea");
      ta.rows = 1;
      ta.spellcheck = false;
      ta.placeholder = "SELECT * FROM …";
      const run = document.createElement("button");
      run.className = "ot-sqlite-run";
      run.textContent = "Run";
      qbar.append(ta, run);
      const grid = document.createElement("div");
      grid.className = "ot-sqlite-grid";
      const note = document.createElement("div");
      note.className = "ot-sqlite-note";
      main.append(qbar, grid, note);
      this.grid = grid;
      this.note = note;

      const runQuery = (sql: string) => {
        try {
          const res = this.db!.exec(sql);
          this.showResult(res);
        } catch (e) {
          this.showError((e as Error)?.message ?? String(e));
        }
      };
      run.addEventListener("click", () => ta.value.trim() && runQuery(ta.value));
      ta.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && ta.value.trim()) runQuery(ta.value);
      });

      for (const t of tableNames) {
        const btn = document.createElement("button");
        btn.className = "ot-sqlite-table";
        btn.textContent = t;
        btn.addEventListener("click", () => {
          this.activeBtn?.classList.remove("is-active");
          btn.classList.add("is-active");
          this.activeBtn = btn;
          const q = `SELECT * FROM "${t.replace(/"/g, '""')}" LIMIT ${ROW_LIMIT}`;
          ta.value = q;
          runQuery(q);
        });
        listEl.appendChild(btn);
      }

      root.append(side, main);
      if (tableNames.length) (listEl.firstElementChild as HTMLElement | null)?.click();
      else note.textContent = "No tables in this database.";
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-sqlite-msg";
      m.textContent = "This database could not be opened:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
    }
  }

  private showResult(res: QueryExecResult[]): void {
    if (!this.grid || !this.note) return;
    this.grid.textContent = "";
    if (!res.length) {
      this.note.textContent = "Query ran; no rows returned.";
      return;
    }
    const { columns, values } = res[0];
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    for (const c of columns) {
      const th = document.createElement("th");
      th.textContent = c;
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    const tbody = document.createElement("tbody");
    for (const row of values) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        if (cell === null) {
          td.textContent = "NULL";
          td.className = "is-null";
        } else if (cell instanceof Uint8Array) {
          td.textContent = `⟨blob ${cell.length} bytes⟩`;
          td.className = "is-null";
        } else {
          td.textContent = String(cell);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    this.grid.appendChild(table);
    this.note.textContent =
      values.length >= ROW_LIMIT ? `Showing the first ${ROW_LIMIT} rows.` : `${values.length} row(s).`;
  }

  private showError(message: string): void {
    if (!this.grid || !this.note) return;
    this.grid.textContent = "";
    this.note.textContent = "";
    const err = document.createElement("div");
    err.className = "ot-sqlite-err";
    err.textContent = message;
    this.grid.appendChild(err);
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    this.db?.close();
    this.db = null;
    this.root?.remove();
    this.root = null;
  }
}

export const sqliteViewer: EditorModule = {
  create: () => new SqliteInstance(),
};
