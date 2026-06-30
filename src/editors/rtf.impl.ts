import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";

// Read-only RTF viewer. Renders the document with rtf.js (MIT, lazy-loaded) into a styled,
// scrollable container. RTF cannot carry scripts, so rtf.js's generated DOM is rendered inline
// (no edit/save path; the app hides Save for this read-only editor).

const STYLE_ID = "omnitext-rtf-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-rtf { height: 100%; overflow: auto; background: var(--canvas); }
    .ot-rtf-doc {
      max-width: 820px; margin: 24px auto; padding: 40px 48px; background: #fff; color: #111;
      box-shadow: 0 2px 12px rgba(0, 0, 0, .25); border-radius: 2px;
      font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .ot-rtf-doc img, .ot-rtf-doc svg { max-width: 100%; }
    .ot-rtf-status { color: var(--text); padding: 28px 34px; }
  `;
  document.head.appendChild(s);
}

class RtfInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const wrap = document.createElement("div");
    wrap.className = "ot-rtf";
    const doc = document.createElement("div");
    doc.className = "ot-rtf-doc";
    doc.textContent = "Rendering…";
    wrap.appendChild(doc);
    container.appendChild(wrap);
    this.wrap = wrap;
    void this.renderInto(doc, ctx.bytes);
  }

  private async renderInto(target: HTMLElement, bytes: Uint8Array | null): Promise<void> {
    if (!bytes || bytes.length === 0) {
      target.className = "ot-rtf-status";
      target.textContent = "No RTF content.";
      return;
    }
    try {
      const { RTFJS } = await import("rtf.js");
      RTFJS.loggingEnabled(false);
      const doc = new RTFJS.Document(bytes.slice().buffer as ArrayBuffer, {});
      const els = await doc.render();
      if (!this.wrap) return; // disposed while rendering
      target.replaceChildren(...els);
    } catch (e) {
      target.className = "ot-rtf-status";
      target.textContent = `Could not render this RTF file: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  getText(): string {
    return ""; // binary, read-only
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

export const rtfEditor: EditorModule = {
  create: () => new RtfInstance(),
};
