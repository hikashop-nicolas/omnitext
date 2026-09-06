import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";
import { extensionOf, formatRequestUrl } from "../core/links";
import { t } from "../i18n";

// Read-only fallback for files Omnitext can't open as text or a known binary type: shows
// size + MIME, a hex dump of the first chunk, and a Download/Share button (so nothing ever
// fails to open). Hidden Save (read-only).
//
// Landing here is the one moment the app knows it fell short, so it is also where it asks
// what the file was. The ask is a link to a prefilled issue, carrying the extension and the
// MIME guess and nothing else; see core/links.

const STYLE_ID = "omnitext-binary-style";
const HEX_LIMIT = 4096; // bytes shown in the dump
const DISMISS_KEY = "omnitext:formatAskDismissed";

// Dismissal is remembered per extension: saying "not this one" about .foo should not also
// silence the question for the next unknown type, which is a different thing to learn.
function dismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function dismiss(ext: string): void {
  try {
    const all = dismissed();
    if (!all.includes(ext)) localStorage.setItem(DISMISS_KEY, JSON.stringify([...all, ext]));
  } catch {
    /* storage unavailable; the box simply comes back next time */
  }
}

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
    /* Sticky, because the dump above it can run to thousands of lines and a box only
       reachable by scrolling past all of them would never be read. */
    .ot-bin-ask { position:sticky; bottom:0; margin:0 16px 16px; padding:12px 14px;
      border:1px solid var(--border); border-radius:8px; background:var(--surface);
      box-shadow:0 2px 12px rgba(0,0,0,.18); display:flex; align-items:flex-start; gap:12px; }
    a.ot-bin-btn { display:inline-block; text-decoration:none; }
    .ot-bin-ask-body { flex:1 1 auto; min-width:0; }
    .ot-bin-ask p { margin:0 0 4px; }
    .ot-bin-ask .ot-bin-ask-hint { color:var(--muted); font-size:12px; margin:0 0 10px; }
    .ot-bin-ask-close { flex:0 0 auto; width:26px; height:26px; line-height:1; padding:0;
      border:0; border-radius:6px; background:transparent; color:var(--muted); font-size:16px;
      cursor:pointer; }
    .ot-bin-ask-close:hover { background:var(--chrome); color:var(--text); }
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
    dl.textContent = t("binary.download");
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
      note.textContent = t("binary.truncated", {
        shown: fmtSize(HEX_LIMIT),
        total: fmtSize(bytes.length),
      });
      wrap.append(note);
    }

    const ask = this.buildAsk(extensionOf(name), ctx.mime);
    if (ask) wrap.append(ask);

    container.appendChild(wrap);
    this.wrap = wrap;
  }

  /** The "what was this file?" box, or null once the reader has waved it away. */
  private buildAsk(ext: string, mime?: string): HTMLElement | null {
    if (dismissed().includes(ext)) return null;

    const box = document.createElement("div");
    box.className = "ot-bin-ask";

    const body = document.createElement("div");
    body.className = "ot-bin-ask-body";
    const lead = document.createElement("p");
    lead.textContent = ext
      ? t("binary.askKnown", { ext })
      : t("binary.askUnknown");
    const hint = document.createElement("p");
    hint.className = "ot-bin-ask-hint";
    hint.textContent = t("binary.askHint");
    const link = document.createElement("a");
    link.className = "ot-bin-btn";
    link.href = formatRequestUrl(ext, mime);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("binary.askAction");
    body.append(lead, hint, link);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ot-bin-ask-close";
    close.textContent = "×";
    close.title = t("binary.askDismiss");
    close.setAttribute("aria-label", t("binary.askDismiss"));
    close.addEventListener("click", () => {
      dismiss(ext);
      box.remove();
    });

    box.append(body, close);
    return box;
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
