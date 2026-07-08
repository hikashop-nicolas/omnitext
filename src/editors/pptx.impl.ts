import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import type { PptxViewer, SlideHandle } from "@aiden0z/pptx-renderer";
import { t } from "../i18n";

// Read-only PowerPoint viewer. @aiden0z/pptx-renderer (Apache-2.0, lazy-loaded)
// renders the slides as a scrollable DOM/SVG list, plus a fullscreen
// presentation mode (arrows / space / click advance). The pdf.js SmartArt
// fallback is disabled: it wants pdfjs-dist v5 while the app ships v6, and it
// only affects EMF-embedded PDFs inside SmartArt.

const STYLE_ID = "omnitext-pptx-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pptx { position: relative; height: 100%; overflow: auto; background: var(--canvas); }
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

class PptxInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private viewer: PptxViewer | null = null;
  private bytes: Uint8Array | null = null;
  private endShow: (() => void) | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-pptx";
    const list = document.createElement("div");
    list.className = "ot-pptx-list";
    list.textContent = t("viewer.rendering");
    wrap.appendChild(list);
    container.appendChild(wrap);
    this.wrap = wrap;
    void this.renderInto(wrap, list, ctx.bytes);
  }

  private async renderInto(wrap: HTMLElement, list: HTMLElement, bytes: Uint8Array | null): Promise<void> {
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
        scrollContainer: wrap,
        zipLimits: RECOMMENDED_ZIP_LIMITS,
        pdfjs: false,
        listOptions: { windowed: true },
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
      wrap.prepend(btn);
    } catch (e) {
      list.className = "ot-pptx-status";
      list.textContent = t("viewer.failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Fullscreen presentation: one slide scaled to the screen; arrows / space /
  // click advance, Escape (native fullscreen exit) leaves and re-syncs the list.
  private startShow(): void {
    const viewer = this.viewer;
    const wrap = this.wrap;
    if (!viewer || !wrap || this.endShow || viewer.slideCount === 0) return;
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
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) step(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) step(-1);
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
      setTimeout(() => void viewer.goToSlide(index, { behavior: "auto", block: "start" }), 120);
      wrap.focus?.();
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
    this.wrap?.focus?.();
  }

  dispose(): void {
    this.endShow?.();
    this.viewer?.destroy();
    this.viewer = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const pptxEditor: EditorModule = {
  create: () => new PptxInstance(),
};
