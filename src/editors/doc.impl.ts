import { createDocEditorAsync, initLocale, type DocEditor } from "richdoc";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";
import { t } from "../i18n";
import { getSettings, userName } from "../settings";

// Thin adapter wrapping richdoc's legacy Word 97-2003 (.doc) editor as an Omnitext editor
// module. richdoc reads the binary to HTML and, on save, regenerates a valid .doc from the
// edited HTML (text + bold/italic/underline/strike, font size, colour, alignment, indent).

const localeReady = initLocale();

class DocInstance implements EditorInstance {
  private editor: DocEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();
  private disposed = false;

  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes ?? new Uint8Array();
    const s = getSettings();
    void localeReady
      .then(() => {
        if (this.disposed) return null;
        return createDocEditorAsync(container, this.bytes, {
          onChange: ctx.onChange,
          author: userName(),
          defaultPageSize: s.pageSize,
          paginated: ctx.docOptions?.paginated ?? s.paginated,
        });
      })
      .then((editor) => {
        if (!editor) return;
        if (this.disposed) editor.destroy(); // disposed while constructing: don't leak the editor
        else this.editor = editor;
      })
      .catch((e: unknown) => {
        console.error("[omnitext] editor construction failed", e);
        this.host.notifications.error(t("notify.readFailed", { what: "doc" }));
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

export const docEditor: EditorModule = {
  create: (host) => new DocInstance(host),
};
