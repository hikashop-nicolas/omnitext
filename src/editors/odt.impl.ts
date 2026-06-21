import { createOdtEditor, type OdtEditor } from "odtedit";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Thin adapter wrapping the standalone odtedit library as an Omnitext editor module.
class OdtInstance implements EditorInstance {
  private editor: OdtEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes ?? new Uint8Array();
    this.editor = createOdtEditor(container, this.bytes, { onChange: ctx.onChange });
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

export const odtEditor: EditorModule = {
  create: () => new OdtInstance(),
};
