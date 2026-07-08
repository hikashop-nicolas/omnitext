import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { t } from "../i18n";

// Read-only PowerPoint viewer. @aiden0z/pptx-renderer (Apache-2.0, lazy-loaded)
// renders the slides as a scrollable DOM/SVG list. The pdf.js SmartArt fallback
// is disabled: it wants pdfjs-dist v5 while the app ships v6, and it only
// affects EMF-embedded PDFs inside SmartArt.

const STYLE_ID = "omnitext-pptx-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pptx { height: 100%; overflow: auto; background: var(--canvas); }
    .ot-pptx-list { max-width: 1080px; margin: 0 auto; padding: 24px 16px; }
    .ot-pptx-list > * { box-shadow: 0 2px 12px rgba(0, 0, 0, .25); margin: 0 0 24px; }
    .ot-pptx-status { color: var(--text); padding: 28px 34px; }
  `;
  document.head.appendChild(s);
}

interface PptxViewerHandle {
  destroy(): void;
}

class PptxInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private viewer: PptxViewerHandle | null = null;
  private bytes: Uint8Array | null = null;

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
    } catch (e) {
      list.className = "ot-pptx-status";
      list.textContent = t("viewer.failed", { error: e instanceof Error ? e.message : String(e) });
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
    this.viewer?.destroy();
    this.viewer = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const pptxEditor: EditorModule = {
  create: () => new PptxInstance(),
};
