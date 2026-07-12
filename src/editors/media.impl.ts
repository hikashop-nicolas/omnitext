import { createMediaPlayer, setLocale, type MediaPlayerHandle } from "mediaplay";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { getLocale } from "../i18n";

// Thin adapter wrapping the standalone mediaplay library (a read-only audio/video
// player: plays the bytes directly, remuxes in memory when the browser can't, and
// renders embedded and external subtitles including styled ASS) as an Omnitext editor
// module. mediaplay draws its own player chrome and overlays and serves its libass
// worker from octopus/ under baseURI (which Omnitext already populates); this adapter
// just hands it the document bytes, syncs the locale, and keeps a handle for teardown.
class MediaInstance implements EditorInstance {
  private handle: MediaPlayerHandle | null = null;
  private bytes: Uint8Array | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    setLocale(getLocale()); // match the app's active locale
    this.bytes = ctx.bytes;
    this.handle = createMediaPlayer(container, {
      bytes: ctx.bytes ?? new Uint8Array(0),
      mime: ctx.mime,
      filename: ctx.filename,
    });
  }

  getText(): string {
    return "";
  }

  getBytes(): Uint8Array | undefined {
    return this.bytes ?? undefined;
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

export const mediaEditor: EditorModule = {
  create: () => new MediaInstance(),
};
