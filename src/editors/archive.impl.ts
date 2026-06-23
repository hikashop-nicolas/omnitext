import { unzipSync } from "fflate";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";

// Read-only archive (zip) viewer: lists the entries and lets you Open one inside Omnitext
// (it is routed back through the open flow to the right editor/viewer) or Extract it (save
// or share). Save of the archive itself is hidden (read-only). Uses fflate, fully in-browser.

const STYLE_ID = "omnitext-archive-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-arc { height:100%; overflow:auto; background:var(--canvas); color:var(--text);
      font:13px/1.5 system-ui, -apple-system, sans-serif; }
    .ot-arc-head { padding:10px 16px; color:var(--muted); border-bottom:1px solid var(--border); }
    .ot-arc-row { display:flex; align-items:center; gap:10px; padding:6px 16px; border-bottom:1px solid var(--border); }
    .ot-arc-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
    .ot-arc-size { color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
    .ot-arc-btn { font:inherit; font-size:12px; padding:3px 10px; border:1px solid var(--border);
      border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; }
    .ot-arc-btn:hover { border-color:var(--accent); }
    .ot-arc-msg { padding:24px; color:var(--muted); }
  `;
  document.head.appendChild(s);
}

const fmtSize = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

class ArchiveInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private bytes: Uint8Array | null = null;
  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-arc";

    let files: Record<string, Uint8Array> = {};
    try {
      files = ctx.bytes ? unzipSync(ctx.bytes) : {};
    } catch {
      wrap.append(msg("This archive could not be read."));
      container.appendChild(wrap);
      this.wrap = wrap;
      return;
    }

    const entries = Object.entries(files).filter(([name]) => !name.endsWith("/"));
    const head = document.createElement("div");
    head.className = "ot-arc-head";
    head.textContent = `${entries.length} file${entries.length === 1 ? "" : "s"}`;
    wrap.append(head);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, data] of entries) {
      const row = document.createElement("div");
      row.className = "ot-arc-row";
      const nm = document.createElement("span");
      nm.className = "ot-arc-name";
      nm.textContent = name;
      nm.title = name;
      const sz = document.createElement("span");
      sz.className = "ot-arc-size";
      sz.textContent = fmtSize(data.length);
      const base = name.split("/").pop() || name;
      const open = btn("Open", () => this.host.workspace.openFile?.(base, data));
      const extract = btn("Extract", () => this.host.workspace.exportFile?.(base, data));
      row.append(nm, sz, open, extract);
      wrap.append(row);
    }
    if (entries.length === 0) wrap.append(msg("This archive is empty."));

    container.appendChild(wrap);
    this.wrap = wrap;
  }

  getText(): string {
    return "";
  }

  getBytes(): Uint8Array | undefined {
    return this.bytes ?? undefined;
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.wrap?.focus?.();
  }

  dispose(): void {
    this.wrap?.remove();
    this.wrap = null;
  }
}

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ot-arc-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function msg(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "ot-arc-msg";
  d.textContent = text;
  return d;
}

export const archiveEditor: EditorModule = {
  create: (host) => new ArchiveInstance(host),
};
