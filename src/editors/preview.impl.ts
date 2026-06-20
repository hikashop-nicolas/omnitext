import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
  PreviewView,
} from "../core/types";

// Read-only preview editor. It asks the format for a "preview" view (ready-to-display
// HTML) and renders it: inline when the format already sanitized it (Markdown), or in
// a sandboxed iframe for untrusted markup (HTML). getText returns the source unchanged.

const STYLE_ID = "omnitext-preview-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-preview { height: 100%; overflow: auto; background: var(--canvas); }
    .ot-preview-doc {
      max-width: 800px; margin: 0 auto; padding: 28px 34px;
      font: 15px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--text);
    }
    .ot-preview-doc h1, .ot-preview-doc h2 {
      border-bottom: 1px solid var(--border); padding-bottom: .2em;
    }
    .ot-preview-doc pre {
      background: var(--surface); padding: 12px 14px; border-radius: 7px; overflow: auto;
    }
    .ot-preview-doc code {
      background: var(--surface); padding: 1px 5px; border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .ot-preview-doc pre code { background: none; padding: 0; }
    .ot-preview-doc img { max-width: 100%; }
    .ot-preview-doc table { border-collapse: collapse; }
    .ot-preview-doc th, .ot-preview-doc td { border: 1px solid var(--border); padding: 5px 9px; }
    .ot-preview-frame { width: 100%; height: 100%; border: 0; background: #fff; }
  `;
  document.head.appendChild(s);
}

class PreviewInstance implements EditorInstance {
  private text = "";
  private wrap: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.text = ctx.text;
    const wrap = document.createElement("div");
    wrap.className = "ot-preview";

    const fmt = ctx.format;
    if (!fmt?.toView) {
      wrap.textContent = "No preview available for this format.";
    } else {
      const view = fmt.toView(fmt.parse(ctx.text).model, "preview") as PreviewView;
      if (view.sandbox) {
        const frame = document.createElement("iframe");
        frame.className = "ot-preview-frame";
        frame.setAttribute("sandbox", ""); // no scripts, no same-origin
        frame.srcdoc = view.html;
        wrap.appendChild(frame);
      } else {
        const doc = document.createElement("div");
        doc.className = "ot-preview-doc";
        doc.innerHTML = view.html; // format guarantees this is sanitized
        wrap.appendChild(doc);
      }
    }

    container.appendChild(wrap);
    this.wrap = wrap;
  }

  getText(): string {
    return this.text; // read-only
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

export const previewEditor: EditorModule = {
  create: () => new PreviewInstance(),
};
