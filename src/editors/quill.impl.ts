import Quill from "quill";
import "quill/dist/quill.snow.css";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// HTML WYSIWYG editor (lazy-loaded), built on Quill. It is a rich-text editor: it
// normalizes HTML to the formats it supports, so it is best for simple documents and
// reformats/simplifies on edit. getText returns the original HTML until the user edits
// (Quill's initial paste fires with source "api", which we ignore), so opening here and
// switching back without editing preserves the source. The byte-exact text editor and
// sandboxed preview remain available.

const STYLE_ID = "omnitext-quill-style";
const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ list: "ordered" }, { list: "bullet" }],
  ["blockquote", "code-block"],
  ["link"],
  ["clean"],
];

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-quill { height: 100%; display: flex; flex-direction: column; background: var(--canvas); }
    .ot-quill .ql-toolbar { border-color: var(--border); background: var(--chrome); }
    .ot-quill .ql-container { flex: 1; overflow: auto; border-color: var(--border); font-size: 14px; }
    .ot-quill .ql-editor { color: var(--text); }
  `;
  document.head.appendChild(s);
}

class QuillInstance implements EditorInstance {
  private quill: Quill | null = null;
  private originalText = "";
  private edited = false;
  private wrap: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.originalText = ctx.text;
    const wrap = document.createElement("div");
    wrap.className = "ot-quill";
    const editorEl = document.createElement("div");
    wrap.appendChild(editorEl);
    container.appendChild(wrap);
    this.wrap = wrap;

    const quill = new Quill(editorEl, { theme: "snow", modules: { toolbar: TOOLBAR } });
    if (ctx.text) quill.clipboard.dangerouslyPasteHTML(ctx.text);
    quill.on("text-change", (_delta, _old, source) => {
      if (source === "user") {
        this.edited = true;
        ctx.onChange();
      }
    });
    this.quill = quill;
  }

  getText(): string {
    return this.edited && this.quill ? this.quill.getSemanticHTML() : this.originalText;
  }

  selection(): unknown {
    return this.quill?.getSelection() ?? null;
  }

  focus(): void {
    this.quill?.focus();
  }

  dispose(): void {
    this.wrap?.remove();
    this.wrap = null;
    this.quill = null;
  }
}

export const quillEditor: EditorModule = {
  create: () => new QuillInstance(),
};
