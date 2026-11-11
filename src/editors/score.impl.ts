import { SOUNDS_CDN, createScoreViewer, loadScore, partFamily, remoteSounds, writeMxl, type ScoreDoc, type ScoreViewerHandle } from "scoredit";
import { getSettings } from "../settings";
import { requestInstrumentSounds } from "../remote-consent";

// Recorded instruments, downloaded per instrument when a score uses them, after asking once.
const sounds = remoteSounds({ base: SOUNDS_CDN, ask: requestInstrumentSounds, cacheName: "omnitext-sounds" });
import { isNative } from "../core/platform";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";
import { ReadingFullscreen } from "./reading-fullscreen";

// The parts of the user's instrument (Settings), when the score has several and some match.
function myParts(score: ScoreDoc): number[] | null {
  const mine = getSettings().scoreInstrument;
  if (!mine || score.parts.length < 2) return null;
  const hits = score.parts.flatMap((p, i) => (partFamily(p) === mine ? [i] : []));
  return hits.length ? hits : null;
}

// Thin adapter around the standalone scoredit library: it reads MusicXML (text) or mxl
// (bytes) and engraves it one system at a time. MusicXML and mxl can be edited; MuseScore
// files stay read-only until scoredit writes them back. Unedited, the file goes back as it came.
class ScoreInstance implements EditorInstance {
  private handle: ScoreViewerHandle | null = null;
  private text = "";
  private bytes: Uint8Array | null = null;
  private edited = false;
  private binary = false;
  private fullscreen: ReadingFullscreen | null = null;

  constructor(_host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.text = ctx.text;
    this.bytes = ctx.bytes;
    this.binary = !!ctx.binary;
    const input = ctx.binary ? (ctx.bytes ?? new Uint8Array(0)) : new TextEncoder().encode(ctx.text);
    // The score as it stands, edits included, for reading it again (the TAB toggle).
    const current = () => (this.edited && this.handle ? new TextEncoder().encode(this.handle.score.serialize()) : input);
    try {
      const loaded = loadScore(input);
      this.fullscreen = new ReadingFullscreen(container, ".sv-shell");
      this.handle = createScoreViewer(container, loaded.score, {
        ...this.fullscreen.options(),
        onError: (e) => console.error(e),
        // Guitar and other fretted parts: a TAB button shows or hides their tab staff.
        tablature: loaded.fretted ? { on: loaded.tab, toggle: (on) => loadScore(current(), { tab: on ? "always" : "never" }).score } : undefined,
        sounds,
        parts: { show: myParts(loaded.score) },
        editable: loaded.format === "musicxml" || loaded.format === "mxl",
        onChange: () => {
          this.edited = true;
          ctx.onChange();
        },
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
    return this.edited && this.handle && !this.binary ? this.handle.score.serialize() : this.text;
  }

  getBytes(): Uint8Array | undefined {
    if (this.edited && this.handle && this.binary) return writeMxl(this.handle.score.serialize(), this.bytes ?? undefined);
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
