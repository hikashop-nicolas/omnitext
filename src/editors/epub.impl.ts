import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import type { Book, Rendition } from "@intity/epub-js";
import { t } from "../i18n";

// Read-only EPUB reader. @intity/epub-js (BSD-2-Clause, lazy-loaded) renders the
// book paginated inside an iframe; prev/next arrows and the keyboard turn pages.

const STYLE_ID = "omnitext-epub-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-epub { position: relative; height: 100%; display: flex; flex-direction: column; background: var(--canvas); }
    .ot-epub-page {
      flex: 1; min-height: 0; max-width: 920px; width: calc(100% - 96px); margin: 16px auto;
      background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, .25); border-radius: 2px; overflow: hidden;
    }
    .ot-epub-page > div { height: 100%; }
    .ot-epub-nav {
      position: absolute; top: 50%; transform: translateY(-50%); z-index: 5;
      width: 36px; height: 64px; border: none; border-radius: 8px; cursor: pointer;
      background: var(--chrome, rgba(0,0,0,.35)); color: var(--text, #fff); font-size: 22px;
    }
    .ot-epub-nav:hover { filter: brightness(1.2); }
    .ot-epub-prev { left: 4px; }
    .ot-epub-next { right: 4px; }
    .ot-epub-status { color: var(--text); padding: 28px 34px; }
  `;
  document.head.appendChild(s);
}

class EpubInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private bytes: Uint8Array | null = null;
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowLeft") void this.rendition?.prev();
    else if (e.key === "ArrowRight") void this.rendition?.next();
  };

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-epub";
    const page = document.createElement("div");
    page.className = "ot-epub-page";
    page.textContent = t("viewer.rendering");
    wrap.appendChild(page);
    container.appendChild(wrap);
    this.wrap = wrap;
    void this.renderInto(wrap, page, ctx.bytes);
  }

  private async renderInto(wrap: HTMLElement, page: HTMLElement, bytes: Uint8Array | null): Promise<void> {
    if (!bytes || bytes.length === 0) {
      page.className = "ot-epub-status";
      page.textContent = t("viewer.empty");
      return;
    }
    try {
      const ePub = (await import("@intity/epub-js")).default;
      const book = ePub(bytes.slice().buffer as ArrayBuffer);
      await book.opened;
      if (!this.wrap) {
        book.destroy(); // disposed while loading
        return;
      }
      page.textContent = "";
      // epub.js overwrites its target element's class, so it gets a holder of its
      // own inside the styled page card.
      const holder = document.createElement("div");
      page.appendChild(holder);
      // Book scripts stay disabled (no allow-scripts); same-origin lets epub.js
      // inject the chapter content into its iframe.
      const rendition = book.renderTo(holder, { width: "100%", height: "100%", spread: "none", sandbox: ["allow-same-origin"] });
      this.book = book;
      this.rendition = rendition;
      await rendition.display();
      // Page-turn arrows on both sides, plus arrow keys (also from inside the iframe).
      const nav = (cls: string, label: string, act: () => void): void => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `ot-epub-nav ${cls}`;
        b.textContent = cls.endsWith("prev") ? "‹" : "›";
        b.title = label;
        b.setAttribute("aria-label", label);
        b.addEventListener("click", act);
        wrap.appendChild(b);
      };
      nav("ot-epub-prev", t("viewer.prevPage"), () => void rendition.prev());
      nav("ot-epub-next", t("viewer.nextPage"), () => void rendition.next());
      wrap.tabIndex = 0;
      wrap.addEventListener("keydown", this.onKey);
      rendition.on("keydown", (e: KeyboardEvent) => this.onKey(e));
    } catch (e) {
      page.className = "ot-epub-status";
      page.textContent = t("viewer.failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  getText(): string {
    return ""; // binary, read-only
  }

  getBytes(): Uint8Array | undefined {
    return this.bytes ?? undefined; // carries the file across a view switch
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.wrap?.focus?.();
  }

  dispose(): void {
    this.rendition = null;
    try {
      this.book?.destroy();
    } catch {
      /* a partially opened book can throw on teardown */
    }
    this.book = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const epubEditor: EditorModule = {
  create: () => new EpubInstance(),
};
