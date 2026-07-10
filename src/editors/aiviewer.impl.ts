import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only Illustrator viewer. Renders the .ai file's PDF-compatible stream with pdf.js
// (Illustrator saves it by default via "Create PDF Compatible File"). A pure/native .ai
// with no PDF stream can't be rendered client-side and shows a clear message instead.

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const STYLE_ID = "omnitext-ai-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-ai { height:100%; overflow:auto; background:var(--canvas); padding:16px;
      display:flex; flex-direction:column; align-items:center; gap:16px; }
    .ot-ai canvas { max-width:100%; height:auto; box-shadow:0 1px 6px rgba(0,0,0,.25);
      background:#fff; }
    .ot-ai-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif;
      padding:24px; text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

class AiInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private task: pdfjs.PDFDocumentLoadingTask | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-ai";
    container.appendChild(root);
    this.root = root;

    const msg = document.createElement("div");
    msg.className = "ot-ai-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);

    void this.render(root, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, bytes: Uint8Array): Promise<void> {
    try {
      // Copy: pdf.js may transfer the buffer to its worker.
      const data = bytes.slice();
      const task = pdfjs.getDocument({ data });
      this.task = task;
      const doc = await task.promise;
      root.textContent = "";
      const scale = Math.min(2, (window.devicePixelRatio || 1) * 1.5);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (context) {
          root.appendChild(canvas);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }
      }
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-ai-msg";
      m.textContent =
        "This .ai file has no PDF-compatible preview to display.\n" +
        "Re-save it from Illustrator with “Create PDF Compatible File” enabled.\n\n" +
        ((e as Error)?.message ?? String(e));
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
      void this.task?.destroy();
    } catch {
      /* ignore */
    }
    this.task = null;
    this.root?.remove();
    this.root = null;
  }
}

export const aiViewer: EditorModule = {
  create: () => new AiInstance(),
};
