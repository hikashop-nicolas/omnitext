import Quill from "quill";
import QuillCursors from "quill-cursors";
import "quill/dist/quill.snow.css";
import type * as Y from "yjs";
import type {
  CollabBinding,
  CollabContext,
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";

/** Where the shared rich text lives. One name per editor: a session pins the editor. */
const SHARED_TEXT = "quill";

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

// Remote carets come from the cursors module, which has to exist when the editor is
// built, so it is registered here rather than when a session starts.
Quill.register("modules/cursors", QuillCursors);

class QuillInstance implements EditorInstance {
  private quill: Quill | null = null;
  private originalText = "";
  private edited = false;
  private wrap: HTMLElement | null = null;
  private binding: { destroy(): void } | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.originalText = ctx.text;
    const wrap = document.createElement("div");
    wrap.className = "ot-quill";
    const editorEl = document.createElement("div");
    wrap.appendChild(editorEl);
    container.appendChild(wrap);
    this.wrap = wrap;

    const quill = new Quill(editorEl, { theme: "snow", modules: { toolbar: TOOLBAR, cursors: true } });
    if (ctx.text) quill.clipboard.dangerouslyPasteHTML(ctx.text);
    quill.on("text-change", (_delta, _old, source) => {
      // A remote edit arrives as an api change. It is still an edit of this document, so
      // it marks it dirty and drives autosave exactly as typing does.
      if (source === "user" || this.binding) {
        this.edited = true;
        ctx.onChange();
      }
    });
    this.quill = quill;
  }

  collab(): CollabBinding {
    return {
      bind: async (ctx: CollabContext) => {
        const quill = this.quill;
        if (!quill) return;
        const { QuillBinding } = await import("y-quill");
        const ytext = ctx.doc.getText(SHARED_TEXT) as Y.Text;
        // Exactly one peer puts a document into an empty session; everyone else takes
        // what is there, which QuillBinding applies to the editor as it attaches.
        if (ctx.seed && ytext.length === 0) ytext.applyDelta(quill.getContents().ops);
        this.binding = new QuillBinding(ytext, quill, ctx.awareness as never);
        if (ctx.readOnly) quill.disable();
      },
      unbind: () => {
        this.binding?.destroy();
        this.binding = null;
      },
    };
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
    this.binding?.destroy();
    this.binding = null;
    this.wrap?.remove();
    this.wrap = null;
    this.quill = null;
  }
}

export const quillEditor: EditorModule = {
  create: () => new QuillInstance(),
};
