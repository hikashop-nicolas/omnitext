import { SOUNDS_CDN, createScoreViewer, exportMp3, exportPdf, exportWav, loadScore, partFamily, remoteSounds, writeGuitarPro, writeMidi, writeMxl, type LoadedScore, type ScoreDoc, type ScoreViewerHandle } from "scoredit";
import { t } from "../i18n";
import { getSettings } from "../settings";
import { requestInstrumentSounds } from "../remote-consent";

// Recorded instruments, downloaded per instrument when a score uses them, after asking once.
const sounds = remoteSounds({ base: SOUNDS_CDN, ask: requestInstrumentSounds, cacheName: "omnitext-sounds" });
import { isNative } from "../core/platform";
import type { EditorInstance, EditorModule, EditorMountContext, ExportTarget, HostAPI } from "../core/types";
import { ReadingFullscreen } from "./reading-fullscreen";

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
// US Letter where it is the norm, A4 elsewhere.
const paper = (): "a4" | "letter" => (/-(US|CA|MX|PH)\b/i.test(navigator.language) ? "letter" : "a4");

// The parts of the user's instrument (Settings), when the score has several and some match.
function myParts(score: ScoreDoc): number[] | null {
  const mine = getSettings().scoreInstrument;
  if (!mine || score.parts.length < 2) return null;
  const hits = score.parts.flatMap((p, i) => (partFamily(p) === mine ? [i] : []));
  return hits.length ? hits : null;
}

// Thin adapter around the standalone scoredit library: it reads MusicXML (text) or mxl
// (bytes) and engraves it one system at a time. MusicXML, mxl and MuseScore 3/4 files can be
// edited: MuseScore files are saved by writing the edited measures back into them. Unedited,
// the file goes back as it came.
class ScoreInstance implements EditorInstance {
  private handle: ScoreViewerHandle | null = null;
  private text = "";
  private bytes: Uint8Array | null = null;
  private edited = false;
  private binary = false;
  private loaded: LoadedScore | null = null;
  private warned = "";
  private host: HostAPI;
  private fullscreen: ReadingFullscreen | null = null;

  constructor(host: HostAPI) {
    this.host = host;
  }

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.text = ctx.text;
    this.bytes = ctx.bytes;
    this.binary = !!ctx.binary;
    const input = ctx.binary ? (ctx.bytes ?? new Uint8Array(0)) : new TextEncoder().encode(ctx.text);
    // The file as it stands, edits included, for reading it again (the TAB toggle).
    const current = () => (!this.edited || !this.handle ? input : this.loaded?.save ? this.loaded.save().bytes : new TextEncoder().encode(this.handle.score.serialize()));
    try {
      const loaded = loadScore(input);
      this.loaded = loaded;
      this.fullscreen = new ReadingFullscreen(container, ".sv-shell");
      this.handle = createScoreViewer(container, loaded.score, {
        ...this.fullscreen.options(),
        onError: (e) => console.error(e),
        // Guitar and other fretted parts: a TAB button shows or hides their tab staff.
        tablature: loaded.fretted
          ? {
              on: loaded.tab,
              toggle: (on) => {
                const next = loadScore(current(), { tab: on ? "always" : "never" });
                this.loaded = next;
                return next.score;
              },
            }
          : undefined,
        sounds,
        parts: { show: myParts(loaded.score) },
        // Guitar Pro saves as GP7: only a GP7 file can take its edits under its own name.
        editable: loaded.format === "musicxml" || loaded.format === "mxl" || (!!loaded.save && (loaded.format !== "guitarpro" || isZip(input))),
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
    if (!this.edited || !this.handle || this.binary) return this.text;
    if (this.loaded?.save) return new TextDecoder().decode(this.saveMuseScore());
    return this.handle.score.serialize();
  }

  getBytes(): Uint8Array | undefined {
    if (!this.edited || !this.handle || !this.binary) return this.bytes ?? undefined;
    if (this.loaded?.save) return this.saveMuseScore();
    return writeMxl(this.handle.score.serialize(), this.bytes ?? undefined);
  }

  /** The MuseScore or Guitar Pro file with the edits; says once what it could not carry over. */
  private saveMuseScore(): Uint8Array {
    const { bytes, dropped } = this.loaded!.save!();
    const kinds = Object.keys(dropped).sort().join(", ");
    const key = this.loaded?.format === "guitarpro" ? "notify.scoreMarksDropped" : "notify.scoreNotSaved";
    if (kinds && kinds !== this.warned) this.host.notifications.warn(t(key, { format: "Guitar Pro", marks: kinds }));
    this.warned = kinds;
    return bytes;
  }

  /** The score as MusicXML, edits included, whatever it was read from. */
  exports(): ExportTarget[] {
    if (!this.handle) return [];
    const xml = () => this.handle!.score.serialize();
    const out: ExportTarget[] = [];
    if (this.loaded?.format !== "musicxml") out.push({ label: "MusicXML", ext: ".musicxml", mime: "application/vnd.recordare.musicxml+xml", build: async () => xml() });
    if (this.loaded?.format !== "mxl") out.push({ label: t("export.mxl"), ext: ".mxl", mime: "application/vnd.recordare.musicxml", build: async () => writeMxl(xml()) });
    const score = this.handle.score;
    out.push({
      label: t("export.guitarPro"),
      ext: ".gp",
      mime: "application/x-guitar-pro",
      build: async () => {
        const { bytes, dropped } = writeGuitarPro(score);
        const kinds = Object.keys(dropped).sort().join(", ");
        if (kinds) this.host.notifications.warn(t("notify.scoreMarksDropped", { format: "Guitar Pro", marks: kinds }));
        return bytes;
      },
    });
    if (this.loaded?.format !== "midi") out.push({ label: "MIDI", ext: ".mid", mime: "audio/midi", build: async () => writeMidi(score) });
    out.push({ label: "PDF", ext: ".pdf", mime: "application/pdf", build: (progress) => exportPdf(score, { paper: paper(), onProgress: progress }) });
    // Audio, with the recorded instruments when the person allows them (asked as for playback).
    out.push({ label: t("export.mp3"), ext: ".mp3", mime: "audio/mpeg", build: (progress) => exportMp3(score, { sounds, onProgress: progress }) });
    out.push({ label: t("export.wav"), ext: ".wav", mime: "audio/wav", build: (progress) => exportWav(score, { sounds, onProgress: progress }) });
    return out;
  }

  /** Printed from the paged PDF: the page view only keeps the systems near the screen drawn. */
  async printableFile(): Promise<{ bytes: Uint8Array; mime: string } | null> {
    if (!this.handle) return null;
    return { bytes: await exportPdf(this.handle.score, { paper: paper() }), mime: "application/pdf" };
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
