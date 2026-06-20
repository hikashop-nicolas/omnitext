import { basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Diagnostic as CmDiagnostic, linter, lintGutter } from "@codemirror/lint";
import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";

// The universal text editor. It consumes the "text" view, so it is the fallback for
// any format. It pulls optional syntax highlighting from the active format's
// language() extension, keeping CodeMirror entirely out of the core.

class CodeMirrorInstance implements EditorInstance {
  private view: EditorView | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    const extensions: Extension[] = [
      basicSetup,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) ctx.onChange();
      }),
    ];
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

  selection(): unknown {
    return this.view ? this.view.state.selection.main : null;
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
  manifest: { kind: "editor", id: "codemirror", consumesViews: ["text"] },
  create(): EditorInstance {
    return new CodeMirrorInstance();
  },
};
