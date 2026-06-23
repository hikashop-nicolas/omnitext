import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";

// Read-only fallback for files Omnitext can't open as text or a known binary type: shows
// size + MIME, a hex dump of the first chunk, and a Download/Share button (so nothing ever
// fails to open). Hidden Save (read-only).

const STYLE_ID = "omnitext-binary-style";
const HEX_LIMIT = 4096; // bytes shown in the dump

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-bin { height:100%; overflow:auto; background:var(--canvas); color:var(--text);
      font:13px/1.5 system-ui, -apple-system, sans-serif; }
    .ot-bin-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
      padding:12px 16px; border-bottom:1px solid var(--border); color:var(--muted); }
    .ot-bin-btn { font:inherit; font-size:12px; padding:4px 12px; border:1px solid var(--border);
      border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; }
    .ot-bin-btn:hover { border-color:var(--accent); }
    .ot-bin-hex { margin:0; padding:12px 16px; white-space:pre; overflow:auto;
      font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color:var(--text); }
    .ot-bin-note { padding:0 16px 16px; color:var(--muted); font-size:12px; }
  `;
  document.head.appendChild(s);
}

const fmtSize = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function hexDump(bytes: Uint8Array, limit: number): string {
  const n = Math.min(bytes.length, limit);
  const lines: string[] = [];
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n));
    let hex = "";
    let ascii = "";
    for (let i = 0; i < 16; i++) {
      hex += i < row.length ? row[i]!.toString(16).padStart(2, "0") + " " : "   ";
      if (i === 7) hex += " ";
      const c = row[i];
      ascii += c === undefined ? "" : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".";
    }
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex} |${ascii}|`);
  }
  return lines.join("\n");
}

class BinaryInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private bytes: Uint8Array | null = null;
  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const bytes = ctx.bytes ?? new Uint8Array();
    const wrap = document.createElement("div");
    wrap.className = "ot-bin";

    const head = document.createElement("div");
    head.className = "ot-bin-head";
    const info = document.createElement("span");
    info.textContent = `${fmtSize(bytes.length)}${ctx.mime ? ` · ${ctx.mime}` : ""}`;
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "ot-bin-btn";
    dl.textContent = "Download";
    const name = this.host.workspace.getActiveDocument()?.filename ?? "file";
    dl.addEventListener("click", () => this.host.workspace.exportFile?.(name, bytes));
    head.append(info, dl);
    wrap.append(head);

    const pre = document.createElement("pre");
    pre.className = "ot-bin-hex";
    pre.textContent = hexDump(bytes, HEX_LIMIT);
    wrap.append(pre);
    if (bytes.length > HEX_LIMIT) {
      const note = document.createElement("div");
      note.className = "ot-bin-note";
      note.textContent = `Showing the first ${fmtSize(HEX_LIMIT)} of ${fmtSize(bytes.length)}. Use Download for the whole file.`;
      wrap.append(note);
    }

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

export const binaryEditor: EditorModule = {
  create: (host) => new BinaryInstance(host),
};
