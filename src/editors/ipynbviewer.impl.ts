import { nb } from "notebookjs";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only Jupyter notebook viewer built on notebookjs. It renders markdown, code and
// output cells; we wire notebookjs to marked (markdown) and DOMPurify (sanitizer) so no
// untrusted HTML from a notebook reaches the page unsanitised. Editing the notebook is
// available by switching to the raw JSON text editor.

const STYLE_ID = "omnitext-ipynb-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-ipynb { height:100%; overflow:auto; background:var(--canvas); color:var(--text); }
    .ot-ipynb-doc { max-width:920px; margin:0 auto; padding:24px 28px; }
    .ot-ipynb-doc .nb-notebook { font:15px/1.6 system-ui, sans-serif; }
    .ot-ipynb-doc .nb-cell { margin:0 0 14px; }
    .ot-ipynb-doc .nb-input, .ot-ipynb-doc .nb-output pre {
      background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:10px 12px;
      overflow:auto; font:12.5px/1.5 ui-monospace, SFMono-Regular, monospace; }
    .ot-ipynb-doc .nb-input { border-left:3px solid var(--accent); }
    .ot-ipynb-doc .nb-output { margin-top:6px; }
    .ot-ipynb-doc .nb-output img, .ot-ipynb-doc img { max-width:100%; height:auto; }
    .ot-ipynb-doc .nb-output table { border-collapse:collapse; font-size:12.5px; }
    .ot-ipynb-doc .nb-output th, .ot-ipynb-doc .nb-output td { border:1px solid var(--border); padding:3px 8px; }
    .ot-ipynb-doc .nb-markdown h1, .ot-ipynb-doc .nb-markdown h2 { border-bottom:1px solid var(--border);
      padding-bottom:.2em; }
    .ot-ipynb-doc pre { margin:0; }
    .ot-ipynb-doc code { font-family:ui-monospace, SFMono-Regular, monospace; }
    .ot-ipynb-doc a { color:var(--accent); }
    .ot-ipynb-msg { margin:24px auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; max-width:720px; }
  `;
  document.head.appendChild(s);
}

let wired = false;
function wireNotebookjs(): void {
  if (wired) return;
  wired = true;
  nb.markdown = (src: string) => marked.parse(src, { async: false }) as string;
  nb.sanitizer = (html: string) => DOMPurify.sanitize(html);
}

class IpynbInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    wireNotebookjs();
    const root = document.createElement("div");
    root.className = "ot-ipynb";
    container.appendChild(root);
    this.root = root;
    try {
      const json = JSON.parse(ctx.text);
      const doc = document.createElement("div");
      doc.className = "ot-ipynb-doc";
      doc.appendChild(nb.parse(json).render());
      root.appendChild(doc);
    } catch (e) {
      const m = document.createElement("div");
      m.className = "ot-ipynb-msg";
      m.textContent =
        "This notebook could not be displayed:\n" + ((e as Error)?.message ?? String(e));
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
    this.root?.remove();
    this.root = null;
  }
}

export const ipynbViewer: EditorModule = {
  create: () => new IpynbInstance(),
};
