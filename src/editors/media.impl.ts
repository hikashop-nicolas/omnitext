import {
  createMediaPlayer,
  isRemote,
  setLocale,
  type MediaPlayerHandle,
  type QueueEntry,
} from "mediaplay";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { getLocale } from "../i18n";
import { requestRemoteMedia } from "../remote-consent";
import { setActiveQueue, takeHandedOverFiles, type HandedFile } from "../core/media-handoff";
import { activeQueueOf, entriesFromFiles, pickFolderFiles, playlistKind, queueFromPlaylistFile, sortMedia } from "../core/media-queue";

/** Told to the app when another file of a queue starts, so the title follows what is playing. */
export const TRACK_EVENT = "omnitext:media-track";

// Thin adapter wrapping the standalone mediaplay library (a read-only audio/video
// player: plays the bytes directly, remuxes in memory when the browser can't, and
// renders embedded and external subtitles including styled ASS) as an Omnitext editor
// module. mediaplay draws its own player chrome and overlays and serves its libass
// worker from octopus/ under baseURI (which Omnitext already populates); this adapter
// just hands it the document bytes, syncs the locale, and keeps a handle for teardown.
//
// A selection of files, a folder, or a playlist file becomes a queue: the app opens the first
// file as the document and hands the rest over (core/media-queue.ts); mediaplay does the rest.
class MediaInstance implements EditorInstance {
  private handle: MediaPlayerHandle | null = null;
  private bytes: Uint8Array | null = null;
  private container: HTMLElement | null = null;
  private ctx: EditorMountContext | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    setLocale(getLocale()); // match the app's active locale
    this.bytes = ctx.bytes;
    this.container = container;
    this.ctx = ctx;
    const files = takeHandedOverFiles();
    const name = ctx.filename ?? "";
    if (playlistKind(name) && ctx.blob) {
      void this.mountPlaylist(ctx.blob as File, files ?? []);
    } else if (files && sortMedia(files).length > 1) {
      const entries = entriesFromFiles(files);
      // The file this document was opened on is already in hand; do not fetch it a second time.
      const own = entries.findIndex((e) => e.title === ctx.filename);
      if (own >= 0 && ctx.blob) {
        entries[own]!.load = async () => ({ blob: ctx.blob!, mime: ctx.mime, filename: ctx.filename });
      }
      this.mountQueue(entries, Math.max(0, own));
    } else {
      this.mountSingle();
    }
  }

  private mountSingle(): void {
    const ctx = this.ctx!;
    // Prefer the on-disk Blob so a multi-GB video streams from disk (mediaplay reads it for
    // playback, remux and synced audio) instead of being held in memory. Only fall back to
    // bytes for an in-memory source (e.g. media extracted from inside an archive).
    this.handle = createMediaPlayer(this.container!, ctx.blob
      ? { blob: ctx.blob, mime: ctx.mime, filename: ctx.filename }
      : { bytes: ctx.bytes ?? new Uint8Array(0), mime: ctx.mime, filename: ctx.filename });
  }

  private mountQueue(entries: QueueEntry[], startIndex: number, onChooseFolder?: () => void): void {
    const hosts = (): string[] => [...new Set(entries.filter((e) => e.unavailable === "remote").map((e) => hostOf(e.source ?? "")))];
    const player = createMediaPlayer(this.container!, entries, {
      startIndex,
      onTrackChange: (_i, entry) => window.dispatchEvent(new CustomEvent(TRACK_EVENT, { detail: { title: entry.title } })),
      allowRemote: () => requestRemoteMedia(hosts()),
      onChooseFolder,
    });
    this.handle = player;
    setActiveQueue(activeQueueOf(player));
  }

  /** A playlist file: its lines are looked up among the files handed over, and if none were (it
   *  was opened alone) the list says so and offers to look in a folder. */
  private async mountPlaylist(file: File, among: HandedFile[]): Promise<void> {
    let entries: QueueEntry[];
    try {
      entries = await queueFromPlaylistFile(file, among);
    } catch (e) {
      this.mountMessage(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!this.container?.isConnected) return; // closed while it was being read
    const chooseFolder = async (): Promise<void> => {
      const picked = await pickFolderFiles();
      if (!picked) return;
      this.handle?.destroy();
      this.handle = null;
      this.container!.textContent = "";
      this.mountQueue(await queueFromPlaylistFile(file, picked), 0, chooseFolder);
    };
    this.mountQueue(entries, Math.max(0, entries.findIndex((e) => !e.unavailable)), chooseFolder);
  }

  private mountMessage(text: string): void {
    const d = document.createElement("div");
    d.className = "ot-media-msg";
    d.textContent = text;
    this.container?.appendChild(d);
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
    setActiveQueue(null);
    this.handle?.destroy();
    this.handle = null;
  }
}

function hostOf(url: string): string {
  try {
    return isRemote(url) ? new URL(url).host : url;
  } catch {
    return url;
  }
}

export const mediaEditor: EditorModule = {
  create: () => new MediaInstance(),
};
