import { readArchiveAsync, type ArchiveEntry } from "../core/archive";
import { openArchiveStream, type ArchiveHandle } from "../core/archive-stream";
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
    // Prefer the on-disk Blob so a large archive is listed without loading it all; fall back
    // to wrapping in-memory bytes (a nested archive opened from inside another).
    const blob = ctx.blob ?? (ctx.bytes ? new Blob([ctx.bytes as BlobPart]) : null);
    const wrap = document.createElement("div");
    wrap.className = "ot-arc";
    wrap.append(msg("Reading…"));
    container.appendChild(wrap);
    this.wrap = wrap;
    void this.load(wrap, blob, ctx.filename);
  }

  private async load(wrap: HTMLElement, blob: Blob | null, filename?: string): Promise<void> {
    let handle: ArchiveHandle | null = null;
    try {
      if (blob) handle = (await openArchiveStream(blob, filename)) ?? (await fullReadFallback(blob, filename));
    } catch {
      handle = null;
    }
    if (wrap !== this.wrap) return; // disposed while reading
    if (!handle) {
      wrap.textContent = "";
      wrap.append(msg("This archive could not be read."));
      return;
    }
    wrap.textContent = "";

    const files = handle.entries.filter((e) => !e.dir).sort((a, b) => a.name.localeCompare(b.name));
    const head = document.createElement("div");
    head.className = "ot-arc-head";
    head.textContent = `${files.length} file${files.length === 1 ? "" : "s"}`;
    wrap.append(head);
    for (const { name, size } of files) {
      const row = document.createElement("div");
      row.className = "ot-arc-row";
      const nm = document.createElement("span");
      nm.className = "ot-arc-name";
      nm.textContent = name;
      nm.title = name;
      const sz = document.createElement("span");
      sz.className = "ot-arc-size";
      sz.textContent = fmtSize(size);
      const base = name.split("/").pop() || name;
      // The body is decompressed only now, for the one entry the user picked.
      const withData = (use: (data: Uint8Array) => void) => async () => {
        try {
          use(await handle.read(name));
        } catch {
          /* a single unreadable entry shouldn't break the listing */
        }
      };
      const open = btn("Open", withData((data) => this.host.workspace.openFile?.(base, data, undefined, name)));
      const extract = btn("Extract", withData((data) => this.host.workspace.exportFile?.(base, data)));
      row.append(nm, sz, open, extract);
      wrap.append(row);
    }
    if (files.length === 0) wrap.append(msg("This archive is empty."));
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

// Fallback for input the streaming reader doesn't recognize: read the whole archive and
// wrap it in an ArchiveHandle so the viewer stays on one code path. Rare (the streamer
// covers zip/tar/tgz/7z/rar/xz/bzip2); this catches oddball or mis-detected inputs.
async function fullReadFallback(blob: Blob, filename?: string): Promise<ArchiveHandle | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let entries: ArchiveEntry[];
  if (isLibarchiveArchive(bytes)) {
    const base = (filename?.split("/").pop() || "archive").replace(/\.[^.]+$/, "");
    entries = await extractWithLibarchive(bytes, base);
  } else {
    entries = await readArchiveAsync(bytes);
  }
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  return {
    entries: entries.filter((e) => !e.name.endsWith("/")).map((e) => ({ name: e.name, size: e.data.length, dir: false })),
    read: (name) => Promise.resolve(byName.get(name) ?? new Uint8Array(0)),
  };
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
