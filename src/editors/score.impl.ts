import { SOUNDS_CDN, createScoreViewer, loadScore, remoteSounds, type ScoreViewerHandle } from "scoredit";
import { requestInstrumentSounds } from "../remote-consent";

// Recorded instruments, downloaded per instrument when a score uses them, after asking once.
const sounds = remoteSounds({ base: SOUNDS_CDN, ask: requestInstrumentSounds, cacheName: "omnitext-sounds" });
import { isNative } from "../core/platform";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";
import { ReadingFullscreen } from "./reading-fullscreen";

// Thin adapter around the standalone scoredit library: it reads MusicXML (text) or mxl
// (bytes) and engraves it one system at a time. Read-only for now; the document's own text
// or bytes go back unchanged.
class ScoreInstance implements EditorInstance {
  private handle: ScoreViewerHandle | null = null;
  private text = "";
  private bytes: Uint8Array | null = null;
  private fullscreen: ReadingFullscreen | null = null;

  constructor(_host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.text = ctx.text;
    this.bytes = ctx.bytes;
    const input = ctx.binary ? (ctx.bytes ?? new Uint8Array(0)) : new TextEncoder().encode(ctx.text);
    try {
      const loaded = loadScore(input);
      this.fullscreen = new ReadingFullscreen(container, ".sv-shell");
      this.handle = createScoreViewer(container, loaded.score, {
        ...this.fullscreen.options(),
        onError: (e) => console.error(e),
        // Guitar and other fretted parts: a TAB button shows or hides their tab staff.
        tablature: loaded.fretted ? { on: loaded.tab, toggle: (on) => loadScore(input, { tab: on ? "always" : "never" }).score } : undefined,
        sounds,
      });
      this.fullscreen.attach(this.handle);
    } catch (e) {
      const p = document.createElement("p");
      p.className = "ot-score-msg";
      p.textContent = e instanceof Error ? e.message : String(e);
      container.append(p);
    }
  }

  getText(): string {
    return this.text;
  }

  getBytes(): Uint8Array | undefined {
    return this.bytes ?? undefined;
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  /** On the phone the viewer's bar takes the status bar's place, with the view switcher in it. */
  viewSwitcherSlot(): HTMLElement | null {
    return isNative() ? (this.handle?.getBarEnd() ?? null) : null;
  }

  dispose(): void {
    this.fullscreen?.dispose();
    this.fullscreen = null;
    this.handle?.destroy();
    this.handle = null;
  }
}

export const scoreEditor: EditorModule = {
  create: (host) => new ScoreInstance(host),
};
