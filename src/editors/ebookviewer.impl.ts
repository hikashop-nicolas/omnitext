import "foliate-js/view.js";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only ebook viewer for non-EPUB books (MOBI, AZW3/KF8, FB2) built on foliate-js,
// which auto-detects the format and paginates the book inside its <foliate-view> custom
// element. DRM-free files only. EPUB stays on the existing epub viewer.

const STYLE_ID = "omnitext-ebook-style";

interface FoliateView extends HTMLElement {
  open(file: Blob): Promise<void>;
  init(opts: { showTextStart?: boolean }): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  goLeft(): void;
  goRight(): void;
  close(): void;
  book?: { metadata?: { title?: string; author?: unknown } };
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-ebook { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--canvas);
      color:var(--text); }
    .ot-ebook-view { flex:1 1 auto; min-height:0; position:relative; }
    .ot-ebook-view foliate-view { display:block; width:100%; height:100%; }
    .ot-ebook-bar { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:6px 12px;
      border-top:1px solid var(--border); background:var(--chrome); font:12px system-ui, sans-serif; }
    .ot-ebook-bar button { border:1px solid var(--border); border-radius:4px; background:var(--surface);
      color:var(--text); cursor:pointer; font:13px system-ui; padding:3px 12px; }
    .ot-ebook-bar button:hover { background:var(--surface-hover, var(--surface)); }
    .ot-ebook-title { flex:1 1 auto; color:var(--muted); white-space:nowrap; overflow:hidden;
      text-overflow:ellipsis; }
    .ot-ebook-pct { color:var(--muted); font-variant-numeric:tabular-nums; }
    .ot-ebook-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

class EbookInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private view: FoliateView | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-ebook";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-ebook-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array(), ctx.filename ?? "book");
  }

  private async render(root: HTMLElement, bytes: Uint8Array, filename: string): Promise<void> {
    try {
      const view = document.createElement("foliate-view") as FoliateView;
      const viewWrap = document.createElement("div");
      viewWrap.className = "ot-ebook-view";
      viewWrap.appendChild(view);

      const bar = document.createElement("div");
      bar.className = "ot-ebook-bar";
      const prev = document.createElement("button");
      prev.textContent = "◀";
      prev.title = "Previous page";
      const next = document.createElement("button");
      next.textContent = "▶";
      next.title = "Next page";
      const title = document.createElement("span");
      title.className = "ot-ebook-title";
      const pct = document.createElement("span");
      pct.className = "ot-ebook-pct";
      bar.append(prev, next, title, pct);

      view.addEventListener("relocate", (e) => {
        const frac = (e as CustomEvent<{ fraction?: number }>).detail?.fraction;
        if (typeof frac === "number") pct.textContent = `${Math.round(frac * 100)}%`;
      });
      prev.addEventListener("click", () => void view.prev());
      next.addEventListener("click", () => void view.next());
      this.onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowLeft") view.goLeft();
        else if (e.key === "ArrowRight") view.goRight();
      };
      viewWrap.addEventListener("keydown", this.onKey);
      viewWrap.tabIndex = 0;

      root.textContent = "";
      root.append(viewWrap, bar);
      this.view = view;

      await view.open(new File([bytes as BlobPart], filename));
      await view.init({ showTextStart: true });
      const meta = view.book?.metadata;
      title.textContent = meta?.title || filename;
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-ebook-msg";
      m.textContent = "This book could not be displayed:\n" + ((e as Error)?.message ?? String(e));
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
    try {
      this.view?.close();
    } catch {
      /* ignore */
    }
    this.view = null;
    this.root?.remove();
    this.root = null;
  }
}

export const ebookViewer: EditorModule = {
  create: () => new EbookInstance(),
};
