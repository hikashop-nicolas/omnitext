import { createDocxEditor, initLocale, type DocxEditor } from "richdoc";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { getSettings, userName } from "../settings";

// Load the browser language once (a dynamic import of the matching richdoc locale chunk; only
// English is bundled). Started when this lazy editor chunk loads, awaited before the editor is
// built so the UI is localised on first paint.
const localeReady = initLocale();

// Thin adapter wrapping richdoc's docx editor as an Omnitext editor module.
class DocxInstance implements EditorInstance {
  private editor: DocxEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();
  private disposed = false;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes ?? new Uint8Array();
    const s = getSettings();
    void localeReady.then(() => {
      if (this.disposed) return;
      this.editor = createDocxEditor(container, this.bytes, {
        onChange: ctx.onChange,
        author: userName(),
        defaultPageSize: s.pageSize,
        paginated: ctx.docOptions?.paginated ?? s.paginated, // per-doc choice (New dialog) wins
      });
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
    this.disposed = true;
    this.editor?.destroy();
    this.editor = null;
  }
}

export const docxEditor: EditorModule = {
  create: () => new DocxInstance(),
};
