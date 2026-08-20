import { createOdtEditorAsync, initLocale, type OdtEditor } from "richdoc";
import type { CollabBinding, EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";
import { richdocBinding } from "./richdoc-binding";
import { t } from "../i18n";
import { takeOverPrinting } from "./richdoc-print";
import { getSettings } from "../settings";

// Load the browser language once (a dynamic import of the matching richdoc locale chunk; only
// English is bundled). Started when this lazy editor chunk loads, awaited before the editor is
// built so the UI is localised on first paint.
const localeReady = initLocale();

// Thin adapter wrapping richdoc's odt editor as an Omnitext editor module.
class OdtInstance implements EditorInstance {
  private editor: OdtEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();
  private disposed = false;
  /** Resolves once the editor exists. A session may start before it does. */
  private ready: Promise<void> = Promise.resolve();

  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes ?? new Uint8Array();
    const s = getSettings();
    this.ready = localeReady
      .then(() => {
        if (this.disposed) return null;
        // Async factory inflates the .odt off the main thread before the (main-thread) parse.
        return createOdtEditorAsync(container, this.bytes, {
          onChange: ctx.onChange,
          defaultPageSize: s.pageSize,
          paginated: ctx.docOptions?.paginated ?? s.paginated, // per-doc choice (New dialog) wins
        });
      })
      .then((editor) => {
        if (!editor) return;
        if (this.disposed) editor.destroy(); // disposed while inflating: don't leak the editor
        else {
          this.editor = editor;
          takeOverPrinting(editor);
        }
      })
      .catch((e: unknown) => {
      // An async construction failure is otherwise an unhandled rejection with a blank editor.
      console.error("[omnitext] editor construction failed", e);
      this.host.notifications.error(t("notify.readFailed", { what: "odt" }));
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

  collab(): CollabBinding {
    // The editor may still be inflating when a session starts; the binding checks.
    return richdocBinding({ handle: () => this.editor, ready: () => this.ready });
  }

  focus(): void {}

  dispose(): void {
    this.disposed = true;
    this.editor?.destroy();
    this.editor = null;
  }
}

export const odtEditor: EditorModule = {
  create: (host) => new OdtInstance(host),
};
