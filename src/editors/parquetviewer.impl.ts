import { parquetReadObjects, parquetMetadata } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only Apache Parquet viewer built on hyparquet (pure-JS reader) + its compressors
// (Snappy/GZIP/Brotli/ZSTD). Shows the columns of the first rows in a grid; the file is
// read entirely in the browser.

const STYLE_ID = "omnitext-parquet-style";
const ROW_LIMIT = 1000;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-parquet { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--canvas);
      color:var(--text); }
    .ot-parquet-head { flex:0 0 auto; padding:8px 12px; border-bottom:1px solid var(--border);
      background:var(--chrome); font:12px system-ui, sans-serif; color:var(--muted); }
    .ot-parquet-grid { flex:1 1 auto; overflow:auto; }
    .ot-parquet-grid table { border-collapse:collapse; font:12px/1.4 ui-monospace, monospace; }
    .ot-parquet-grid th, .ot-parquet-grid td { border:1px solid var(--border); padding:3px 8px; text-align:left;
      white-space:nowrap; max-width:360px; overflow:hidden; text-overflow:ellipsis; }
    .ot-parquet-grid th { position:sticky; top:0; background:var(--chrome); font-weight:600; z-index:1; }
    .ot-parquet-grid th small { color:var(--muted); font-weight:400; margin-left:6px; }
    .ot-parquet-grid td.is-null { color:var(--muted); font-style:italic; }
    .ot-parquet-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

class ParquetInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-parquet";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-parquet-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, bytes: Uint8Array): Promise<void> {
    try {
      const arrayBuffer = ab(bytes);
      const meta = parquetMetadata(arrayBuffer);
      const totalRows = Number(meta.num_rows);
      // Column types from the schema (skip the root element).
      const types = new Map<string, string>();
      for (const el of meta.schema) {
        if (el.type) types.set(el.name, String(el.type));
      }
      const file = {
        byteLength: arrayBuffer.byteLength,
        slice: (start: number, end?: number) => arrayBuffer.slice(start, end),
      };
      const rows = (await parquetReadObjects({
        file,
        compressors,
        rowStart: 0,
        rowEnd: Math.min(totalRows, ROW_LIMIT),
      })) as Record<string, unknown>[];
      root.textContent = "";

      const columns = rows.length
        ? Object.keys(rows[0])
        : meta.schema.filter((e) => e.type).map((e) => e.name);

      const head = document.createElement("div");
      head.className = "ot-parquet-head";
      head.textContent = `${totalRows.toLocaleString()} row${totalRows === 1 ? "" : "s"} · ${columns.length} columns${
        totalRows > ROW_LIMIT ? ` · showing first ${ROW_LIMIT}` : ""
      }`;
      root.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "ot-parquet-grid";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      for (const c of columns) {
        const th = document.createElement("th");
        th.textContent = c;
        const ty = types.get(c);
        if (ty) {
          const small = document.createElement("small");
          small.textContent = ty.toLowerCase();
          th.appendChild(small);
        }
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (const c of columns) {
          const td = document.createElement("td");
          const v = row[c];
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
      grid.appendChild(table);
      root.appendChild(grid);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-parquet-msg";
      m.textContent = "This Parquet file could not be read:\n" + ((e as Error)?.message ?? String(e));
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

export const parquetViewer: EditorModule = {
  create: () => new ParquetInstance(),
};
