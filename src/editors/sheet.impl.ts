import { createSheetEditor, type SheetEditor } from "sheetedit";
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

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.binary = ctx.binary;
    this.text = ctx.text;
    this.bytes = ctx.bytes ?? new TextEncoder().encode(ctx.text);
    const isTsv = (ctx.mime ?? "").includes("tab-separated") || /\.tsv$/i.test(ctx.filename ?? "");
    this.editor = createSheetEditor(container, this.bytes, {
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
    this.editor?.destroy();
    this.editor = null;
  }
}

export const sheetEditor: EditorModule = {
  create: () => new SheetInstance(),
};
