import { createSheetEditorAsync, type SheetEditor } from "sheetedit";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Thin adapter wrapping the standalone sheetedit library (.xlsx/.ods/.csv grid editor
// with formula recalculation and in-place preservation) as an Omnitext editor module.
// Binary workbooks flow through bytes; csv/tsv documents flow through the app's text
// pipeline (encoding menu, history, .gz) via sheetedit's synchronous getText().
class SheetInstance implements EditorInstance {
  private editor: SheetEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();
  private text = "";
  private binary = true;
  private disposed = false;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.binary = ctx.binary;
    this.text = ctx.text;
    this.bytes = ctx.bytes ?? new TextEncoder().encode(ctx.text);
    const isTsv = (ctx.mime ?? "").includes("tab-separated") || /\.tsv$/i.test(ctx.filename ?? "");
    // Async factory inflates a zip-based workbook off the main thread before the parse.
    void createSheetEditorAsync(container, this.bytes, {
      onChange: ctx.onChange,
      formatHint: ctx.binary ? undefined : isTsv ? "tsv" : "csv",
      fileName: ctx.filename,
      onConvert: (bytes, name) => {
        window.dispatchEvent(
          new CustomEvent("omnitext:open-bytes", {
            detail: { name, bytes, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          }),
        );
      },
    })
      .then((editor) => {
        if (this.disposed) editor.destroy(); // disposed while inflating: don't leak the editor
        else this.editor = editor;
      })
      .catch((e: unknown) => {
        console.error("[omnitext] sheet editor construction failed", e);
      });
  }

  getText(): string {
    if (this.binary) return "";
    return this.editor?.getText() ?? this.text;
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

export const sheetEditor: EditorModule = {
  create: () => new SheetInstance(),
};
