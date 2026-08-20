import { basicSetup } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Diagnostic as CmDiagnostic, linter, lintGutter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import type * as Y from "yjs"; // types only: the adapter itself is loaded on demand
import type {
  CollabBinding,
  CollabContext,
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";

// The universal text editor (lazy-loaded). It consumes the "text" view, so it is the
// fallback for any format. It pulls optional syntax highlighting and diagnostics from
// the active format, keeping CodeMirror entirely out of the core.

/** The shared document's field name. Every peer must agree on it, so it is fixed here. */
const SHARED_TEXT = "codemirror";

// Comfortable typography and spacing, applied in both themes.
const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px" },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { border: "none", background: "transparent" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 14px" },
});

const prefersDark = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

class CodeMirrorInstance implements EditorInstance {
  private view: EditorView | null = null;
  /** Holds the collaboration extension, so a session can start and end after mount. */
  private readonly collabSlot = new Compartment();

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    const extensions: Extension[] = [
      basicSetup,
      baseTheme,
      EditorView.lineWrapping,
      this.collabSlot.of([]),
      EditorView.updateListener.of((u) => {
        // Remote edits arrive as ordinary document changes, which is what we want: they
        // mark the document dirty and drive autosave exactly as typing does.
        if (u.docChanged) ctx.onChange();
      }),
    ];
    if (prefersDark()) extensions.push(oneDark);
    const langExt = ctx.format?.language?.();
    if (langExt) extensions.push(langExt as Extension);

    // Surface the format's diagnostics in the gutter. For text-model formats the
    // model is the text, so we pass the document text as both model and text.
    const fmt = ctx.format;
    if (fmt?.validate) {
      extensions.push(lintGutter());
      extensions.push(
        linter((view) => {
          const text = view.state.doc.toString();
          const len = text.length;
          return fmt.validate!(text, text).map((d): CmDiagnostic => {
            const from = Math.max(0, Math.min(d.from ?? 0, len));
            const to = Math.max(from, Math.min(d.to ?? from, len));
            return { from, to, severity: d.severity, message: d.message };
          });
        }),
      );
    }

    this.view = new EditorView({
      parent: container,
      state: EditorState.create({ doc: ctx.text, extensions }),
    });
  }

  getText(): string {
    return this.view ? this.view.state.doc.toString() : "";
  }

  /**
   * The whole document as plain text for printing. CodeMirror keeps only the lines around
   * the viewport in the DOM (about twenty of them), and print takes the DOM as it finds it,
   * so printing the live surface yields the first page of any long file. Highlighting is
   * lost here, which is the trade for printing all of it.
   */
  printable(): HTMLElement | null {
    const pre = document.createElement("pre");
    pre.className = "print-text";
    pre.textContent = this.getText();
    return pre;
  }

  selection(): unknown {
    return this.view ? this.view.state.selection.main : null;
  }

  /**
   * Collaboration, via y-codemirror.next: a Y.Text mirrors the document and remote
   * cursors come from awareness. Loaded on demand, so a session's cost is paid only by
   * someone who starts one.
   */
  collab(): CollabBinding {
    return {
      bind: async (ctx: CollabContext) => {
        const view = this.view;
        if (!view) return;
        const { yCollab } = await import("y-codemirror.next");
        const ytext = ctx.doc.getText(SHARED_TEXT) as Y.Text;

        if (ctx.seed) {
          // Exactly one peer populates the shared document, from what is on screen.
          if (ytext.length === 0) ytext.insert(0, view.state.doc.toString());
        } else {
          // A joiner adopts the session's text wholesale. Done before the extension is
          // attached, so this replacement is not mirrored back as an edit of its own.
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: ytext.toString() },
          });
        }

        const extensions: Extension[] = [yCollab(ytext, ctx.awareness as never)];
        if (ctx.readOnly) extensions.push(EditorView.editable.of(false));
        view.dispatch({ effects: this.collabSlot.reconfigure(extensions) });
      },
      unbind: () => {
        this.view?.dispatch({ effects: this.collabSlot.reconfigure([]) });
      },
    };
  }

  focus(): void {
    this.view?.focus();
  }

  dispose(): void {
    this.view?.destroy();
    this.view = null;
  }
}

export const codemirrorEditor: EditorModule = {
  create(): EditorInstance {
    return new CodeMirrorInstance();
  },
};
