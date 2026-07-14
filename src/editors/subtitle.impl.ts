import { createSubtitleEditor, type SubtitleEditorHandle } from "subedit";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// subedit reads the format from the filename extension. A new blank document has no
// filename, so map the format's MIME (always set by the host) to a synthetic name, else
// a blank .ass would open as SRT. Real opened files keep their own filename.
const MIME_EXT: Record<string, string> = {
  "application/x-subrip": "srt",
  "text/srt": "srt",
  "text/vtt": "vtt",
  "text/x-ass": "ass",
  "text/x-ssa": "ssa",
};

function subtitleFilename(ctx: EditorMountContext): string | undefined {
  if (ctx.filename) return ctx.filename;
  const ext = ctx.mime ? MIME_EXT[ctx.mime] : undefined;
  return ext ? `untitled.${ext}` : undefined;
}

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
      { text: ctx.text, filename: subtitleFilename(ctx) },
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
