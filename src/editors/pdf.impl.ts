import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createPdfEditor, type PdfEditor, type PdfEditState } from "pdfedit";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Thin adapter wrapping the standalone pdfedit library as an Omnitext editor module.
class PdfInstance implements EditorInstance {
  private editor: PdfEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();
  private container: HTMLElement | null = null;
  private onChange: (() => void) | undefined;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.container = container;
    this.onChange = ctx.onChange;
    this.bytes = ctx.bytes ?? new Uint8Array();
    this.editor = createPdfEditor(container, this.bytes, {
      workerSrc: workerUrl,
      onChange: ctx.onChange,
    });
  }

  getText(): string {
    return "";
  }

  getBytes(): Promise<Uint8Array> {
    return this.editor ? this.editor.getBytes() : Promise.resolve(this.bytes);
  }

  // History snapshots the editing session (pristine bytes + edits), not the lossy export.
  getState(): unknown {
    return this.editor?.getState() ?? null;
  }

  // Restore re-renders the pristine document and replays the edits, in place.
  setState(state: unknown): void {
    if (!this.container || !state) return;
    const st = state as PdfEditState;
    this.editor?.destroy();
    this.bytes = st.original;
    this.editor = createPdfEditor(this.container, st.original, {
      workerSrc: workerUrl,
      initialState: st,
      onChange: this.onChange,
    });
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  dispose(): void {
    this.editor?.destroy();
    this.editor = null;
  }
}

export const pdfEditor: EditorModule = {
  create: () => new PdfInstance(),
};
