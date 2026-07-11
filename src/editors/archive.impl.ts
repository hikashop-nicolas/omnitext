import { readArchiveAsync, type ArchiveEntry } from "../core/archive";
import { extractWithLibarchive, isLibarchiveArchive } from "../core/libarchive";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";

// Read-only archive viewer: lists the entries and lets you Open one inside Omnitext (it is
// routed back through the open flow to the right editor/viewer) or Extract it (save or
// share). Save of the archive itself is hidden (read-only). zip/tar/tar.gz go through
// fflate + the tar codec; 7z/RAR/xz/bzip2/zstd/lz4 go through libarchive-wasm on demand.
// Fully in-browser.

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
    wrap.append(msg("Reading…"));
    container.appendChild(wrap);
    this.wrap = wrap;
    void this.load(wrap, ctx.bytes, ctx.filename);
  }

  private async load(
    wrap: HTMLElement,
    bytes: Uint8Array | null,
    filename?: string,
  ): Promise<void> {
    let entries: ArchiveEntry[] = [];
    try {
      entries = await getEntries(bytes, filename);
    } catch {
      wrap.textContent = "";
      wrap.append(msg("This archive could not be read."));
      return;
    }
    if (wrap !== this.wrap) return; // disposed while extracting
    wrap.textContent = "";

    const head = document.createElement("div");
    head.className = "ot-arc-head";
    head.textContent = `${entries.length} file${entries.length === 1 ? "" : "s"}`;
    wrap.append(head);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const { name, data } of entries) {
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
      const open = btn("Open", () => this.host.workspace.openFile?.(base, data, undefined, name));
      const extract = btn("Extract", () => this.host.workspace.exportFile?.(base, data));
      row.append(nm, sz, open, extract);
      wrap.append(row);
    }
    if (entries.length === 0) wrap.append(msg("This archive is empty."));
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

// Pick the extractor by content: libarchive for 7z/RAR/xz/bzip2/zstd/lz4, else fflate.
async function getEntries(bytes: Uint8Array | null, filename?: string): Promise<ArchiveEntry[]> {
  if (!bytes) return [];
  if (isLibarchiveArchive(bytes)) {
    const base = (filename?.split("/").pop() || "archive").replace(/\.[^.]+$/, "");
    return (await extractWithLibarchive(bytes, base)).filter((e) => !e.name.endsWith("/"));
  }
  return (await readArchiveAsync(bytes)).filter((e) => !e.name.endsWith("/"));
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
