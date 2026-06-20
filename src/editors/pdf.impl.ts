import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createPdfEditor, type PdfEditor } from "pdfedit";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Thin adapter wrapping the standalone pdfedit library as an Omnitext editor module.
class PdfInstance implements EditorInstance {
  private editor: PdfEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();

  mount(container: HTMLElement, ctx: EditorMountContext): void {
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
