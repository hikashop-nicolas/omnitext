import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { t } from "../i18n";

// Read-only audio/video viewer. Plays the bytes via a blob URL in a <video> or <audio>
// element (chosen by MIME). Codec support is whatever the platform WebView provides; an
// unsupported file shows a clear message instead of a broken player.
// Player shortcuts: space/K play-pause, F fullscreen (video), M mute, arrows seek/volume,
// Home/End jump; handled on the wrapper so they work wherever focus sits in the viewer.

const STYLE_ID = "omnitext-media-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-media { height:100%; overflow:auto; background:#000;
      display:flex; align-items:center; justify-content:center; outline:none; }
    .ot-media video { max-width:100%; max-height:100%; }
    .ot-media audio { width:min(90%, 520px); }
    .ot-media-msg { color:#bbb; padding:24px; font:14px system-ui, sans-serif; text-align:center; }
  `;
  document.head.appendChild(s);
}

const SEEK_STEP = 5; // seconds
const VOLUME_STEP = 0.05;

class MediaInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private url: string | null = null;
  private bytes: Uint8Array | null = null;

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
      const hint = t(isAudio ? "viewer.mediaKeysAudio" : "viewer.mediaKeys");
      m.title = hint;
      wrap.setAttribute("aria-label", hint);
      m.addEventListener("error", () => {
        wrap.textContent = "";
        const d = document.createElement("div");
        d.className = "ot-media-msg";
        d.textContent = t("viewer.mediaUnsupported");
        wrap.appendChild(d);
      });
      wrap.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
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
            else void (m as HTMLVideoElement).requestFullscreen?.().catch(() => undefined);
            break;
          case "m":
            m.muted = !m.muted;
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
      });
      wrap.appendChild(m);
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
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const mediaEditor: EditorModule = {
  create: () => new MediaInstance(),
};
