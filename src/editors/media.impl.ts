import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { t } from "../i18n";
import { decodeSubtitleBytes, extractMkvInfo, subtitleFileToVtt, type MkvAudioTrack } from "./mkv-subs";

// Read-only audio/video viewer. Plays the bytes via a blob URL in a <video> or <audio>
// element (chosen by MIME). Codec support is whatever the platform WebView provides; when
// direct playback fails, the file is remuxed in memory (mediabunny, lazy chunk) into a
// container the browser accepts — no re-encode, the document bytes stay untouched — and
// only if that also fails does the clear "not supported" message show.
// Player shortcuts: space/K play-pause, F fullscreen (video), M mute, arrows seek/volume,
// Home/End jump; handled on the wrapper so they work wherever focus sits in the viewer.

const STYLE_ID = "omnitext-media-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-media { height:100%; overflow:auto; background:#000; position:relative;
      display:flex; align-items:center; justify-content:center; outline:none; }
    .ot-media-stage { position:relative; display:flex; max-width:100%; max-height:100%; }
    .ot-media video { max-width:100%; max-height:100%; }
    /* F fullscreens the whole player (wrap), so the libass canvas and the overlays
       ride along; the video then fills the screen with letterboxing. */
    .ot-media:fullscreen .ot-media-stage { width:100%; height:100%; }
    .ot-media:fullscreen video { width:100%; height:100%; max-width:none; max-height:none; object-fit:contain; }
    /* libass canvas parent: out of the flex flow, pinned to the video's box (octopus
       sets position:relative inline, hence the !important). */
    .ot-media-stage .libassjs-canvas-parent { position:absolute !important; top:0; left:0; }
    .ot-media audio { width:min(90%, 520px); }
    .ot-media-msg { color:#bbb; padding:24px; font:14px system-ui, sans-serif; text-align:center; }
    .ot-media-rate { position:absolute; top:14px; right:16px; z-index:1; pointer-events:none;
      background:rgba(20,20,24,0.85); color:#fff; font:600 14px system-ui, sans-serif;
      padding:6px 10px; border-radius:8px; opacity:0; transition:opacity .2s; }
    .ot-media-rate.show { opacity:1; }
    .ot-media-tracksbtn { position:absolute; top:12px; left:14px; z-index:2;
      background:rgba(20,20,24,0.85); color:#fff; font:600 13px system-ui, sans-serif;
      padding:6px 10px; border:1px solid rgba(255,255,255,0.25); border-radius:8px; cursor:pointer; }
    .ot-media-tracksbtn:hover { background:rgba(50,50,58,0.9); }
    .ot-media-menu { position:absolute; top:44px; left:14px; z-index:3; min-width:200px;
      background:rgba(24,24,30,0.97); color:#eee; font:13px system-ui, sans-serif;
      border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:6px; }
    .ot-media-menu h4 { margin:4px 8px; font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:#9aa; }
    .ot-media-menu button { display:block; width:100%; text-align:left; font:inherit; color:inherit;
      background:none; border:0; border-radius:6px; padding:6px 8px; cursor:pointer; }
    .ot-media-menu button:hover { background:rgba(255,255,255,0.12); }
    .ot-media-menu button.on::before { content:"✓ "; }
    .ot-media-menu button:not(.on) { padding-left:22px; }
  `;
  document.head.appendChild(s);
}

// Han/kana/hangul in a subtitle script: the bundled libass fallback font is Latin-only,
// so styled rendering would show tofu; those tracks use the plain-text path instead.
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

const SEEK_STEP = 5; // seconds
const VOLUME_STEP = 0.05;
const RATE_STEP = 0.2;
const RATE_KEY = "omnitext.mediaRate"; // playback speed, remembered across files

/** Rebuild the file keeping only the chosen audio track (stream copy), for audio switching:
 * browsers expose no API to pick among a file's embedded audio tracks. */
async function remuxWithAudioTrack(bytes: Uint8Array, keepTrackId: number): Promise<Blob | null> {
  const mb = await import("mediabunny");
  try {
    const input = new mb.Input({ source: new mb.BufferSource(bytes.slice().buffer), formats: mb.ALL_FORMATS });
    const target = new mb.BufferTarget();
    const format = new mb.MkvOutputFormat();
    const output = new mb.Output({ format, target });
    const conversion = await mb.Conversion.init({
      input,
      output,
      audio: (track) => (track.id === keepTrackId ? {} : { discard: true }),
    });
    if (!conversion.isValid) return null;
    await conversion.execute();
    return target.buffer ? new Blob([target.buffer], { type: format.mimeType }) : null;
  } catch {
    return null;
  }
}

/**
 * Repackage the bytes into a browser-friendly container (stream copy where the codec is
 * allowed in the target, WebCodecs transcode where the platform can decode but the copy
 * isn't allowed). Returns null when no target container can represent the tracks.
 */
async function tryRemux(bytes: Uint8Array, isAudio: boolean): Promise<Blob | null> {
  const mb = await import("mediabunny");
  const targets = isAudio
    ? [new mb.Mp4OutputFormat(), new mb.OggOutputFormat(), new mb.WavOutputFormat()]
    : [new mb.Mp4OutputFormat(), new mb.WebMOutputFormat()];
  for (const format of targets) {
    try {
      const input = new mb.Input({ source: new mb.BufferSource(bytes.slice().buffer), formats: mb.ALL_FORMATS });
      const target = new mb.BufferTarget();
      const output = new mb.Output({ format, target });
      const conversion = await mb.Conversion.init({ input, output });
      if (!conversion.isValid) continue;
      await conversion.execute();
      if (target.buffer) return new Blob([target.buffer], { type: format.mimeType });
    } catch {
      // try the next container
    }
  }
  return null;
}

class MediaInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private url: string | null = null;
  private bytes: Uint8Array | null = null;
  private onDocKey: ((e: KeyboardEvent) => void) | null = null;
  private subUrls: string[] = [];
  private teardown: (() => void)[] = [];

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-media";
    wrap.tabIndex = 0;
    const mime = ctx.mime ?? "";
    if (ctx.bytes && ctx.bytes.length) {
      const blob = new Blob([ctx.bytes as BlobPart], mime ? { type: mime } : undefined);
      this.url = URL.createObjectURL(blob);
      const isAudio = mime.startsWith("audio/");
      const m = document.createElement(isAudio ? "audio" : "video") as HTMLMediaElement;
      m.src = this.url;
      m.controls = true;
      m.autoplay = true; // opening a file is the user's intent to play; policy-blocked = stays paused
      const hint = t(isAudio ? "viewer.mediaKeysAudio" : "viewer.mediaKeys");
      m.title = hint;
      wrap.setAttribute("aria-label", hint);
      // Playback speed: S slower / D faster, remembered across files (like a player).
      const rateBadge = document.createElement("div");
      rateBadge.className = "ot-media-rate";
      let rateTimer = 0;
      const setRate = (rate: number, show: boolean) => {
        const r = Math.min(4, Math.max(0.2, Math.round(rate * 10) / 10));
        m.playbackRate = r;
        try {
          localStorage.setItem(RATE_KEY, String(r));
        } catch {
          /* private mode */
        }
        if (show) {
          rateBadge.textContent = `${r}×`;
          rateBadge.classList.add("show");
          window.clearTimeout(rateTimer);
          rateTimer = window.setTimeout(() => rateBadge.classList.remove("show"), 900);
        }
      };
      const savedRate = Number(localStorage.getItem(RATE_KEY));
      if (savedRate && savedRate !== 1) m.addEventListener("loadeddata", () => setRate(savedRate, false), { once: true });
      // Assigned in the video-only tracks section below; C toggles subtitles.
      let toggleSubs: () => void = () => undefined;
      const fail = () => {
        wrap.textContent = "";
        const d = document.createElement("div");
        d.className = "ot-media-msg";
        d.textContent = t("viewer.mediaUnsupported");
        wrap.appendChild(d);
      };
      let remuxed = false;
      m.addEventListener("error", () => {
        if (remuxed) return fail();
        remuxed = true;
        const note = document.createElement("div");
        note.className = "ot-media-msg";
        note.textContent = t("viewer.mediaConverting");
        wrap.appendChild(note);
        tryRemux(ctx.bytes!, isAudio).then(
          (blob) => {
            note.remove();
            if (!blob) return fail();
            if (this.url) URL.revokeObjectURL(this.url);
            this.url = URL.createObjectURL(blob);
            m.src = this.url; // a second error on the remuxed source falls through to fail()
          },
          () => {
            note.remove();
            fail();
          },
        );
      });
      // Document-level so the shortcuts work no matter where focus sits (the open
      // dialog returns focus to the toolbar, drag-drop leaves it on the body, ...).
      // Typing and button/menu interaction elsewhere is never hijacked.
      this.onDocKey = (e: KeyboardEvent) => {
        if (!wrap.isConnected || wrap.offsetParent === null) return; // gone or hidden (view switch)
        // Already claimed by someone else (e.g. a speed-controller browser extension
        // handling S/D itself): don't double-handle, or every press fires twice.
        if (e.defaultPrevented) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el && !wrap.contains(el) && el.closest("input, textarea, select, button, a, [contenteditable], [role=dialog], [role=menu], [role=listbox]"))
          return;
        const key = e.key === " " ? " " : e.key.length === 1 ? e.key.toLowerCase() : e.key;
        switch (key) {
          case " ":
          case "k":
            if (m.paused) void m.play();
            else m.pause();
            break;
          case "f":
            if (isAudio) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void wrap.requestFullscreen?.().catch(() => undefined); // wrap, so subs/overlays come along
            break;
          case "m":
            m.muted = !m.muted;
            break;
          case "s":
            setRate(m.playbackRate - RATE_STEP, true);
            break;
          case "d":
            setRate(m.playbackRate + RATE_STEP, true);
            break;
          case "c":
            toggleSubs();
            break;
          case "ArrowLeft":
            m.currentTime = Math.max(0, m.currentTime - SEEK_STEP);
            break;
          case "ArrowRight":
            m.currentTime = Math.min(m.duration || Infinity, m.currentTime + SEEK_STEP);
            break;
          case "ArrowUp":
            m.volume = Math.min(1, m.volume + VOLUME_STEP);
            m.muted = false;
            break;
          case "ArrowDown":
            m.volume = Math.max(0, m.volume - VOLUME_STEP);
            break;
          case "Home":
            m.currentTime = 0;
            break;
          case "End":
            if (Number.isFinite(m.duration)) m.currentTime = m.duration;
            break;
          default:
            return;
        }
        e.preventDefault();
      };
      document.addEventListener("keydown", this.onDocKey);
      // The open dialog's focus-restore lands on the toolbar after mount; once the
      // media is ready, pull focus into the player so the shortcuts work immediately.
      m.addEventListener(
        "loadeddata",
        () => {
          if (!wrap.contains(document.activeElement)) wrap.focus();
        },
        { once: true },
      );
      // Tracks (video only): embedded subtitles are extracted to WebVTT <track>s (the
      // video element ignores in-container subs), a menu switches subtitle and audio
      // tracks and loads external .srt/.ass/.vtt files, and C toggles subtitles.
      if (!isAudio) {
        interface SubEntry {
          label: string;
          lang: string;
          vtt: string;
          /** Full .ass text: selected tracks render styled via libass (lazy WASM). */
          assDoc?: string;
          el: HTMLTrackElement | null;
        }
        const subTracks: SubEntry[] = [];
        let activeSub = -1;
        let lastSub = 0;
        let audioTracks: MkvAudioTrack[] = [];
        let activeAudio = 0;
        let octopus: { dispose(): void } | null = null;
        let octopusFor = -1;
        const dropOctopus = () => {
          try {
            octopus?.dispose();
          } catch {
            /* worker already gone */
          }
          octopus = null;
          octopusFor = -1;
          wrap.querySelector(".libassjs-canvas-parent")?.remove(); // stage child
        };
        this.teardown.push(dropOctopus);
        // Styled ASS rendering via SubtitlesOctopus (libass WASM, same-origin worker
        // assets under octopus/). Falls back to the plain-text VTT track on failure.
        const startOctopus = async (i: number) => {
          const entry = subTracks[i]!;
          try {
            const mod = await import("@jellyfin/libass-wasm");
            if (!this.wrap || activeSub !== i) return; // switched away while loading
            const SubtitlesOctopus = mod.default;
            octopus = new SubtitlesOctopus({
              video: m as HTMLVideoElement,
              subContent: entry.assDoc!,
              workerUrl: new URL("octopus/subtitles-octopus-worker.js", document.baseURI).toString(),
              fallbackFont: new URL("octopus/default.woff2", document.baseURI).toString(),
              onError: () => {
                dropOctopus();
                showVttFallback(i);
              },
            });
            octopusFor = i;
          } catch {
            showVttFallback(i);
          }
        };
        const showVttFallback = (i: number) => {
          if (activeSub !== i) return;
          const entry = subTracks[i]!;
          if (!entry.el) entry.el = attachTrackEl(entry);
          entry.el.track.mode = "showing";
        };
        // The native controls' own fullscreen button fullscreens the bare video, where
        // the libass canvas can't follow; bridge with the in-video text track meanwhile.
        const onFsChange = () => {
          const entry = activeSub >= 0 ? subTracks[activeSub] : undefined;
          if (!entry || !octopus) return;
          const videoOnlyFs = document.fullscreenElement === m;
          if (videoOnlyFs) {
            if (!entry.el) entry.el = attachTrackEl(entry);
            entry.el.track.mode = "showing";
          } else if (entry.el) {
            entry.el.track.mode = "disabled";
          }
        };
        document.addEventListener("fullscreenchange", onFsChange);
        this.teardown.push(() => document.removeEventListener("fullscreenchange", onFsChange));

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ot-media-tracksbtn";
        btn.textContent = "CC ▾";
        btn.title = t("viewer.tracksMenu");
        const menu = document.createElement("div");
        menu.className = "ot-media-menu";
        menu.hidden = true;
        btn.addEventListener("click", () => {
          menu.hidden = !menu.hidden;
          if (!menu.hidden) rebuildMenu();
        });
        const closeMenu = (e: MouseEvent) => {
          if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== btn) menu.hidden = true;
        };
        document.addEventListener("click", closeMenu);
        this.teardown.push(() => document.removeEventListener("click", closeMenu));

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".srt,.vtt,.ass,.ssa";
        fileInput.hidden = true;
        fileInput.addEventListener("change", async () => {
          const f = fileInput.files?.[0];
          fileInput.value = "";
          menu.hidden = true;
          if (!f) return;
          try {
            const raw = new Uint8Array(await f.arrayBuffer());
            const vtt = subtitleFileToVtt(f.name, raw);
            const isAss = /\.(ass|ssa)$/i.test(f.name);
            addSubTrack(
              { label: f.name.replace(/\.[^.]+$/, ""), lang: "und", vtt, assDoc: isAss ? decodeSubtitleBytes(raw) : undefined },
              true,
            );
          } catch {
            /* unreadable subtitle file */
          }
        });

        const attachTrackEl = (entry: SubEntry): HTMLTrackElement => {
          const track = document.createElement("track");
          track.kind = "subtitles";
          track.label = entry.label;
          track.srclang = entry.lang;
          const url = URL.createObjectURL(new Blob([entry.vtt], { type: "text/vtt" }));
          this.subUrls.push(url);
          track.src = url;
          m.appendChild(track);
          return track;
        };
        const setSub = (i: number) => {
          activeSub = i;
          if (i >= 0) lastSub = i;
          if (octopusFor !== i) dropOctopus();
          const target = i >= 0 ? subTracks[i] : undefined;
          const styled = !!target?.assDoc && !CJK_RE.test(target.assDoc);
          subTracks.forEach((entry, j) => {
            if (entry.el) entry.el.track.mode = j === i && !styled ? "showing" : "disabled";
          });
          if (target && !styled && !target.el) {
            target.el = attachTrackEl(target);
            target.el.track.mode = "showing";
          }
          if (target && styled && octopusFor !== i) void startOctopus(i);
          rebuildMenu();
        };
        toggleSubs = () => {
          if (subTracks.length) setSub(activeSub >= 0 ? -1 : Math.min(lastSub, subTracks.length - 1));
        };
        const addSubTrack = (entry: Omit<SubEntry, "el">, select: boolean) => {
          subTracks.push({ ...entry, el: null });
          if (select) setSub(subTracks.length - 1);
          else rebuildMenu();
        };

        const switchAudio = async (i: number) => {
          menu.hidden = true;
          if (i === activeAudio) return;
          const note = document.createElement("div");
          note.className = "ot-media-msg";
          note.textContent = t("viewer.mediaConverting");
          wrap.appendChild(note);
          const blob = await remuxWithAudioTrack(ctx.bytes!, audioTracks[i]!.number);
          note.remove();
          if (!blob || !this.wrap) return;
          const pos = m.currentTime;
          const wasPaused = m.paused;
          const rate = m.playbackRate;
          if (this.url) URL.revokeObjectURL(this.url);
          this.url = URL.createObjectURL(blob);
          m.src = this.url;
          m.addEventListener(
            "loadeddata",
            () => {
              m.currentTime = pos;
              m.playbackRate = rate;
              if (!wasPaused) void m.play();
              else m.pause(); // autoplay would otherwise restart a paused player
            },
            { once: true },
          );
          activeAudio = i;
          rebuildMenu();
        };

        const rebuildMenu = () => {
          menu.textContent = "";
          const section = (label: string) => {
            const h = document.createElement("h4");
            h.textContent = label;
            menu.appendChild(h);
          };
          const item = (label: string, on: boolean, fn: () => void) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            if (on) b.classList.add("on");
            b.addEventListener("click", fn);
            menu.appendChild(b);
          };
          section(t("viewer.subtitles"));
          item(t("viewer.subtitlesOff"), activeSub < 0, () => {
            setSub(-1);
            menu.hidden = true;
          });
          subTracks.forEach((entry, i) =>
            item(entry.label || `#${i + 1}`, activeSub === i, () => {
              setSub(i);
              menu.hidden = true;
            }),
          );
          item(t("viewer.loadSubtitles"), false, () => fileInput.click());
          if (audioTracks.length > 1) {
            section(t("viewer.audioTracks"));
            audioTracks.forEach((a, i) => item(a.label || a.language || `#${i + 1}`, activeAudio === i, () => void switchAudio(i)));
          }
        };
        rebuildMenu();

        window.setTimeout(() => {
          if (!this.wrap) return;
          try {
            const info = extractMkvInfo(ctx.bytes!);
            info.subtitles.forEach((s, i) => addSubTrack({ label: s.label || s.language, lang: s.language, vtt: s.vtt, assDoc: s.assDoc }, i === 0));
            audioTracks = info.audio;
            rebuildMenu();
          } catch {
            /* track info is best-effort */
          }
        });
        wrap.appendChild(btn);
        wrap.appendChild(menu);
        wrap.appendChild(fileInput);
      }
      const stage = document.createElement("div");
      stage.className = "ot-media-stage";
      stage.appendChild(m);
      wrap.appendChild(stage);
      wrap.appendChild(rateBadge);
    } else {
      const d = document.createElement("div");
      d.className = "ot-media-msg";
      d.textContent = t("viewer.mediaEmpty");
      wrap.appendChild(d);
    }
    container.appendChild(wrap);
    this.wrap = wrap;
    wrap.focus();
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
    this.wrap?.focus?.();
  }

  dispose(): void {
    for (const fn of this.teardown) fn();
    this.teardown = [];
    if (this.onDocKey) document.removeEventListener("keydown", this.onDocKey);
    this.onDocKey = null;
    for (const u of this.subUrls) URL.revokeObjectURL(u);
    this.subUrls = [];
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const mediaEditor: EditorModule = {
  create: () => new MediaInstance(),
};
