import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import type { PptxViewer, SlideHandle } from "@aiden0z/pptx-renderer";
import { t } from "../i18n";

// Read-only PowerPoint viewer. @aiden0z/pptx-renderer (Apache-2.0, lazy-loaded)
// renders the slides as a scrollable DOM/SVG list with a thumbnail sidebar,
// arrow/space slide navigation, and a fullscreen presentation mode. The pdf.js
// SmartArt fallback is disabled: it wants pdfjs-dist v5 while the app ships v6,
// and it only affects EMF-embedded PDFs inside SmartArt.

const STYLE_ID = "omnitext-pptx-style";
const THUMB_W = 148;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pptx { display: flex; height: 100%; background: var(--canvas); }
    .ot-pptx-side {
      flex: none; width: ${THUMB_W + 28}px; overflow-y: auto; padding: 10px;
      display: flex; flex-direction: column; gap: 8px; align-items: center;
      background: var(--chrome2, rgba(0, 0, 0, .15)); border-right: 1px solid var(--border, #333);
    }
    @media (max-width: 720px) { .ot-pptx-side { display: none; } }
    .ot-pptx-thumb {
      border: 2px solid transparent; border-radius: 6px; padding: 3px; background: none;
      cursor: pointer; color: var(--muted, #999); font: 11px system-ui, sans-serif; text-align: center;
    }
    .ot-pptx-thumb.active { border-color: var(--accent, #4a7dff); color: var(--text, #ddd); }
    .ot-pptx-thumb-box { width: ${THUMB_W}px; background: #fff; overflow: hidden; border-radius: 3px; pointer-events: none; }
    .ot-pptx-main { flex: 1; min-width: 0; position: relative; overflow: auto; outline: none; }
    .ot-pptx-list { max-width: 1080px; margin: 0 auto; padding: 24px 16px; }
    .ot-pptx-list > * { box-shadow: 0 2px 12px rgba(0, 0, 0, .25); margin: 0 0 24px; }
    .ot-pptx-status { color: var(--text); padding: 28px 34px; }
    .ot-pptx-presentbtn {
      position: sticky; top: 10px; float: right; margin: 0 14px 0 0; z-index: 5;
      display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
      border: 1px solid var(--border, #444); border-radius: 8px; cursor: pointer;
      background: var(--chrome, #2b2f36); color: var(--text, #eee); font: inherit;
    }
    .ot-pptx-presentbtn:hover { filter: brightness(1.15); }
    .ot-pptx-show {
      position: fixed; inset: 0; z-index: 100; background: #000;
      display: flex; align-items: center; justify-content: center; cursor: pointer; outline: none;
    }
    .ot-pptx-show-count {
      position: absolute; right: 14px; bottom: 10px; color: rgba(255, 255, 255, .6);
      font: 13px system-ui, sans-serif; user-select: none;
    }
  `;
  document.head.appendChild(s);
}

/** Keys that advance / rewind a slideshow, shared by the list and the fullscreen show. */
const NEXT_KEYS = ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"];
const PREV_KEYS = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"];

class PptxInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private main: HTMLElement | null = null;
  private viewer: PptxViewer | null = null;
  private bytes: Uint8Array | null = null;
  private endShow: (() => void) | null = null;
  private thumbs: SlideHandle[] = [];
  private thumbBtns: HTMLButtonElement[] = [];

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-pptx";
    const side = document.createElement("div");
    side.className = "ot-pptx-side";
    side.setAttribute("role", "tablist");
    side.setAttribute("aria-label", t("viewer.slides"));
    side.hidden = true; // shown once the deck is open
    const main = document.createElement("div");
    main.className = "ot-pptx-main";
    main.tabIndex = 0;
    const list = document.createElement("div");
    list.className = "ot-pptx-list";
    list.textContent = t("viewer.rendering");
    main.appendChild(list);
    wrap.append(side, main);
    container.appendChild(wrap);
    this.wrap = wrap;
    this.main = main;
    void this.renderInto(side, main, list, ctx.bytes);
  }

  private async renderInto(side: HTMLElement, main: HTMLElement, list: HTMLElement, bytes: Uint8Array | null): Promise<void> {
    if (!bytes || bytes.length === 0) {
      list.className = "ot-pptx-status";
      list.textContent = t("viewer.empty");
      return;
    }
    try {
      const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import("@aiden0z/pptx-renderer");
      list.textContent = "";
      const viewer = await PptxViewer.open(bytes.slice(), list, {
        fitMode: "contain",
        scrollContainer: main,
        zipLimits: RECOMMENDED_ZIP_LIMITS,
        pdfjs: false,
        listOptions: { windowed: true },
        onSlideChange: (i) => this.markActive(i),
      });
      if (!this.wrap) {
        viewer.destroy(); // disposed while rendering
        return;
      }
      this.viewer = viewer;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ot-pptx-presentbtn";
      btn.textContent = `⛶ ${t("viewer.present")}`;
      btn.title = t("viewer.presentTitle");
      btn.addEventListener("click", () => this.startShow());
      main.prepend(btn);
      // Arrows / space snap between slides in the list view too.
      this.wrap.addEventListener("keydown", (e) => {
        if (this.endShow || !this.viewer) return; // fullscreen show has its own keys
        if (e.target instanceof HTMLElement && e.target.closest("button") && (e.key === " " || e.key === "Enter")) return; // let buttons click
        if (NEXT_KEYS.includes(e.key)) this.stepList(1);
        else if (PREV_KEYS.includes(e.key)) this.stepList(-1);
        else if (e.key === "Home") this.goList(0);
        else if (e.key === "End") this.goList(this.viewer.slideCount - 1);
        else return;
        e.preventDefault();
      });
      main.focus({ preventScroll: true });
      await this.buildSidebar(side, viewer);
    } catch (e) {
      list.className = "ot-pptx-status";
      list.textContent = t("viewer.failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private goList(i: number): void {
    void this.viewer?.goToSlide(i, { behavior: "auto", block: "start" });
    this.markActive(Math.max(0, Math.min(i, (this.viewer?.slideCount ?? 1) - 1)));
  }

  private stepList(d: number): void {
    if (!this.viewer) return;
    this.goList(this.viewer.currentSlideIndex + d);
  }

  // Thumbnail sidebar: one small rendered slide per entry, click to jump.
  private async buildSidebar(side: HTMLElement, viewer: PptxViewer): Promise<void> {
    if (viewer.slideCount < 2) return; // nothing to navigate
    side.hidden = false;
    for (let i = 0; i < viewer.slideCount; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ot-pptx-thumb";
      btn.setAttribute("role", "tab");
      btn.title = t("viewer.slideN", { n: i + 1 });
      const box = document.createElement("div");
      box.className = "ot-pptx-thumb-box";
      const num = document.createElement("div");
      num.textContent = String(i + 1);
      btn.append(box, num);
      btn.addEventListener("click", () => this.goList(i));
      side.appendChild(btn);
      this.thumbBtns.push(btn);
      const h = viewer.renderThumbnailToContainer(i, box, { width: THUMB_W });
      if (h) this.thumbs.push(h);
      // Yield between thumbnails so a big deck does not freeze the UI.
      if (i % 4 === 3) await new Promise((r) => setTimeout(r));
      if (!this.wrap) return; // disposed mid-build
    }
    this.markActive(viewer.currentSlideIndex);
  }

  private markActive(i: number): void {
    this.thumbBtns.forEach((b, j) => {
      b.classList.toggle("active", j === i);
      b.setAttribute("aria-selected", j === i ? "true" : "false");
    });
    this.thumbBtns[i]?.scrollIntoView({ block: "nearest" });
  }

  // Fullscreen presentation: one slide scaled to the screen; arrows / space /
  // click advance, Escape (native fullscreen exit) leaves and re-syncs the list.
  private startShow(): void {
    const viewer = this.viewer;
    const main = this.main;
    if (!viewer || !main || this.endShow || viewer.slideCount === 0) return;
    const show = document.createElement("div");
    show.className = "ot-pptx-show";
    show.tabIndex = -1;
    const count = document.createElement("div");
    count.className = "ot-pptx-show-count";
    let index = Math.max(0, Math.min(viewer.currentSlideIndex, viewer.slideCount - 1));
    let handle: SlideHandle | null = null;

    const renderSlide = () => {
      handle?.dispose();
      show.replaceChildren(count);
      const scale = Math.min(show.clientWidth / viewer.slideWidth, show.clientHeight / viewer.slideHeight);
      handle = viewer.renderThumbnailToContainer(index, show, { scale });
      count.textContent = `${index + 1} / ${viewer.slideCount}`;
    };
    const step = (d: number) => {
      const next = index + d;
      if (next < 0 || next >= viewer.slideCount) return;
      index = next;
      renderSlide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (NEXT_KEYS.includes(e.key)) step(1);
      else if (PREV_KEYS.includes(e.key)) step(-1);
      else if (e.key === "Home") { index = 0; renderSlide(); }
      else if (e.key === "End") { index = viewer.slideCount - 1; renderSlide(); }
      else if (e.key === "Escape") end(); // fallback when fullscreen was denied
      else return;
      e.preventDefault();
    };
    const onResize = () => renderSlide();
    const onFsChange = () => {
      if (document.fullscreenElement !== show) end();
    };
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.endShow = null;
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("resize", onResize);
      handle?.dispose();
      handle = null;
      show.remove();
      if (document.fullscreenElement === show) void document.exitFullscreen();
      // Sync the list to the slide we ended at, once the fullscreen-exit reflow
      // settled; instant scroll (smooth would animate through every slide).
      setTimeout(() => this.goList(index), 120);
      main.focus?.({ preventScroll: true });
    };
    this.endShow = end;

    show.addEventListener("click", () => step(1));
    show.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFsChange);
    window.addEventListener("resize", onResize);
    document.body.appendChild(show);
    // Fullscreen needs the click gesture; if it is denied the fixed overlay still presents.
    show.requestFullscreen?.().catch(() => undefined);
    renderSlide();
    show.focus();
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
    this.main?.focus?.({ preventScroll: true });
  }

  dispose(): void {
    this.endShow?.();
    for (const h of this.thumbs) h.dispose();
    this.thumbs = [];
    this.thumbBtns = [];
    this.viewer?.destroy();
    this.viewer = null;
    this.main = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const pptxEditor: EditorModule = {
  create: () => new PptxInstance(),
};
