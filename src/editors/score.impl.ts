import { SOUNDS_CDN, createScoreViewer, exportMp3, exportPdf as scoreditPdf, exportWav, isNotationMidi, loadScore, webMidiInput, webMidiOutput, partFamily, remoteSounds, writeGuitarPro, writeMidi, writeMxl, type LoadedScore, type PdfExportOptions, type PdfFonts, type ScoreDoc, type ScoreViewerHandle } from "scoredit";
import { t } from "../i18n";
import { SETTINGS_SAVED, getSettings } from "../settings";
import { requestInstrumentSounds } from "../remote-consent";
import { pdfScoreXml } from "./score-pdf";
import type { CollabBinding, Disposable, EditorInstance, EditorModule, EditorMountContext, ExportTarget, HostAPI } from "../core/types";
import type { Transport } from "scoredit";
import { scoreBinding } from "./score-collab";
import { ReadingFullscreen } from "./reading-fullscreen";

// Recorded instruments, downloaded per instrument when a score uses them, after asking once.
const sounds = remoteSounds({ base: SOUNDS_CDN, ask: requestInstrumentSounds, cacheName: "omnitext-sounds" });

// PDF faces for non-Western text: the app's own font files (craftbridge's), fetched only for scripts a
// score uses; an empty URL (a build without the engines) keeps the standard font.
const fontBytes = new Map<string, Promise<Uint8Array | null>>();
const face = (key: "japanese" | "hans" | "hangul" | "latin" | "arabic" | "hebrew") => async () => {
  const url = (await import("craftbridge/deck")).deckFontUrls[key];
  if (!url) return null;
  if (!fontBytes.has(url))
    fontBytes.set(
      url,
      fetch(url)
        .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
        .catch(() => null)
        .then((b) => (b || fontBytes.delete(url), b)),
    );
  return fontBytes.get(url)!;
};
// Inter covers extended Latin, Cyrillic and Greek.
const latin = face("latin");
const scoreFonts: PdfFonts = { japanese: face("japanese"), chinese: face("hans"), korean: face("hangul"), latin, cyrillic: latin, greek: latin, arabic: face("arabic"), hebrew: face("hebrew") };
const exportPdf = (score: ScoreDoc, opts: PdfExportOptions = {}) => scoreditPdf(score, { fonts: scoreFonts, ...opts });

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
// The page size chosen in Settings.
const paper = () => getSettings().pageSize;

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
  /** Read from a PDF: saved as a PDF engraved again from the edited score. */
  private fromPdf = false;
  private warnedPdf = false;
  private midiCommand: Disposable | null = null;
  // Stops following the MIDI ports (devices plugged in or out) for the instrument's output.
  private midiPorts: (() => void) | null = null;
  private host: HostAPI;
  private fullscreen: ReadingFullscreen | null = null;
  // In a shared session, where this device's playback changes go (the conductor's only).
  private transportOut: ((t: Transport) => void) | null = null;
  private readonly applySettings = () => this.handle?.setOutputDelay(getSettings().soundDelayMs);

  constructor(host: HostAPI) {
    this.host = host;
  }

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.text = ctx.text;
    this.bytes = ctx.bytes;
    this.binary = !!ctx.binary;
    // A score PDF shows the MusicXML read from it when it was opened.
    const pdfXml = ctx.bytes ? pdfScoreXml.get(ctx.bytes.buffer) : undefined;
    this.fromPdf = pdfXml !== undefined;
    const input = pdfXml !== undefined ? new TextEncoder().encode(pdfXml) : ctx.binary ? (ctx.bytes ?? new Uint8Array(0)) : new TextEncoder().encode(ctx.text);
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
        // Each part can also be left silent here: to play it yourself, or in a shared score.
        parts: { show: myParts(loaded.score), onSilentChange: () => {} },
        practice: { latencyMs: getSettings().midiDelayMs },
        // Practice shows before a keyboard is connected, with a button that asks the browser for MIDI.
        connectMidi: () => void this.connectMidi(true),
        // Guitar Pro saves as GP7: only a GP7 file can take its edits under its own name.
        // MIDI saves in place, played timing kept on untouched notes; edits happen in the page view.
        editable: loaded.format === "musicxml" || loaded.format === "mxl" || (!!loaded.save && (loaded.format !== "guitarpro" || isZip(input))),
        // A played-in MIDI file reads better as falling notes than as notation.
        layout: loaded.format === "midi" && !isNotationMidi(input) ? "keys" : undefined,
        onChange: () => {
          this.edited = true;
          ctx.onChange();
        },
        onTransport: (t) => this.transportOut?.(t),
        outputDelayMs: getSettings().soundDelayMs,
      });
      this.fullscreen.attach(this.handle);
      window.addEventListener(SETTINGS_SAVED, this.applySettings);
      // A MIDI keyboard for practising: connected at once where access is already granted (the app),
      // otherwise on request from the palette, since browsers ask for permission.
      void this.connectMidi(false);
      this.midiCommand = this.host.commands.register({ id: "score.connectMidi", title: t("midi.connect"), run: () => this.connectMidi(true) });
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

  getBytes(): Uint8Array | Promise<Uint8Array> | undefined {
    if (!this.edited || !this.handle || !this.binary) return this.bytes ?? undefined;
    // An edited score PDF is engraved again (the original engraving cannot take the edits).
    if (this.fromPdf) {
      if (!this.warnedPdf) this.host.notifications.info(t("notify.scorePdfReengraved"));
      this.warnedPdf = true;
      return exportPdf(this.handle.score, { paper: paper() });
    }
    if (this.loaded?.save) return this.saveMuseScore();
    return writeMxl(this.handle.score.serialize(), this.bytes ?? undefined);
  }

  /** The MuseScore, Guitar Pro or MIDI file with the edits; says once what it could not carry over. */
  private saveMuseScore(): Uint8Array {
    const { bytes, dropped } = this.loaded!.save!();
    const kinds = Object.keys(dropped).sort().join(", ");
    const format = this.loaded?.format === "guitarpro" ? "Guitar Pro" : this.loaded?.format === "midi" ? "MIDI" : "";
    const key = format ? "notify.scoreMarksDropped" : "notify.scoreNotSaved";
    if (kinds && kinds !== this.warned) this.host.notifications.warn(t(key, { format, marks: kinds }));
    this.warned = kinds;
    return bytes;
  }

  /** The score as MusicXML, edits included, whatever it was read from. */
  exports(): ExportTarget[] {
    if (!this.handle) return [];
    const xml = () => this.handle!.score.serialize();
    const out: ExportTarget[] = [];
    if (this.loaded?.format !== "musicxml" || this.fromPdf) out.push({ label: "MusicXML", ext: ".musicxml", mime: "application/vnd.recordare.musicxml+xml", build: async () => xml() });
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

  /** Shared: the person who shared it conducts playback, the others follow; nobody edits. */
  collab(): CollabBinding | null {
    if (!this.handle) return null;
    const off = { edit: t("collab.scoreEditOff"), practice: t("collab.scorePracticeOff") };
    return scoreBinding({
      viewer: () => this.handle,
      onTransport: (emit) => (this.transportOut = emit),
      current: () => {
        const p = this.handle?.player;
        const a = p?.anchor();
        const speed = p?.getSpeed() ?? 1;
        return a ? { playing: true, time: a.time, at: a.at, speed } : { playing: false, time: p?.time ?? 0, at: performance.now(), speed };
      },
      reasons: { conductor: off, follower: { ...off, play: t("collab.scoreFollows") } },
    });
  }

  focus(): void {}

  /** On the phone the viewer's bar takes the status bar's place, with the view switcher in it. */
  viewSwitcherSlot(): HTMLElement | null {
    return this.handle?.getBarEnd() ?? null;
  }

  /** Gives the score a MIDI keyboard; asking only when the person asked for it. */
  private async connectMidi(ask: boolean): Promise<void> {
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
    if (!nav.requestMIDIAccess || !this.handle) {
      if (ask) this.host.notifications.warn(t("midi.unavailable"));
      return;
    }
    if (!ask) {
      const state = await navigator.permissions?.query({ name: "midi" as PermissionName }).then((p) => p.state, () => "prompt");
      if (state !== "granted") return;
    }
    try {
      const access = await nav.requestMIDIAccess();
      this.handle?.setMidiInput(webMidiInput(access));
      // The keyboard's output, so it can play the parts not practised; picked again as devices come and go.
      this.midiPorts?.();
      const outputs = () => this.handle?.setMidiOutput(webMidiOutput(access));
      access.addEventListener("statechange", outputs);
      this.midiPorts = () => access.removeEventListener("statechange", outputs);
      outputs();
      if (ask) this.host.notifications.info(t("midi.connected"));
    } catch {
      if (ask) this.host.notifications.warn(t("midi.denied"));
    }
  }

  dispose(): void {
    window.removeEventListener(SETTINGS_SAVED, this.applySettings);
    this.midiPorts?.();
    this.midiPorts = null;
    this.midiCommand?.dispose();
    this.midiCommand = null;
    this.fullscreen?.dispose();
    this.fullscreen = null;
    this.handle?.destroy();
    this.handle = null;
  }
}

export const scoreEditor: EditorModule = {
  create: (host) => new ScoreInstance(host),
};
