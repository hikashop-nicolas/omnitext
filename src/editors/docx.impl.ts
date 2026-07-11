import { createDocxEditorAsync, initLocale, type DocxEditor } from "richdoc";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";
import { t } from "../i18n";
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

  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes ?? new Uint8Array();
    const s = getSettings();
    void localeReady
      .then(() => {
        if (this.disposed) return null;
        // Async factory inflates the .docx off the main thread before the (main-thread) parse.
        return createDocxEditorAsync(container, this.bytes, {
          onChange: ctx.onChange,
          author: userName(),
          defaultPageSize: s.pageSize,
          paginated: ctx.docOptions?.paginated ?? s.paginated, // per-doc choice (New dialog) wins
        });
      })
      .then((editor) => {
        if (!editor) return;
        if (this.disposed) editor.destroy(); // disposed while inflating: don't leak the editor
        else this.editor = editor;
      })
      .catch((e: unknown) => {
      // An async construction failure is otherwise an unhandled rejection with a blank editor.
      console.error("[omnitext] editor construction failed", e);
      this.host.notifications.error(t("notify.readFailed", { what: "docx" }));
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
  create: (host) => new DocxInstance(host),
};
