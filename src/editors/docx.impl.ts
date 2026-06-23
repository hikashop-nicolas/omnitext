import { createDocxEditor, type DocxEditor } from "docxedit";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { userName } from "../settings";

// Thin adapter wrapping the standalone docxedit library as an Omnitext editor module.
class DocxInstance implements EditorInstance {
  private editor: DocxEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes ?? new Uint8Array();
    this.editor = createDocxEditor(container, this.bytes, { onChange: ctx.onChange, author: userName() });
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

export const docxEditor: EditorModule = {
  create: () => new DocxInstance(),
};
