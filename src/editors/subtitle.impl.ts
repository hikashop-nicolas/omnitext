import { createSubtitleEditor, type SubtitleEditorHandle } from "subedit";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Thin adapter wrapping the standalone subedit library (subtitle editor for SRT / VTT /
// ASS / SSA, with cue list, timing pane and video/waveform preview, byte-preserving
// round-trips) as an Omnitext editor module. subedit renders its own toolbar and panes;
// this adapter just routes edits back through the Omnitext host. Saving is handled by
// Omnitext (getText -> format.serialize), so subedit's own save button stays hidden.
class SubtitleInstance implements EditorInstance {
  private handle: SubtitleEditorHandle | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.handle = createSubtitleEditor(
      container,
      { text: ctx.text, filename: ctx.filename },
      { onChange: ctx.onChange, showSave: false },
    );
  }

  getText(): string {
    return this.handle?.getText() ?? "";
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.handle?.focus();
  }

  dispose(): void {
    this.handle?.destroy();
    this.handle = null;
  }
}

export const subtitleEditor: EditorModule = {
  create: () => new SubtitleInstance(),
};
