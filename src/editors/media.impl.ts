import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only audio/video viewer. Plays the bytes via a blob URL in a <video> or <audio>
// element (chosen by MIME). Codec support is whatever the platform WebView provides; an
// unsupported file shows a clear message instead of a broken player.

const STYLE_ID = "omnitext-media-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-media { height:100%; overflow:auto; background:#000;
      display:flex; align-items:center; justify-content:center; }
    .ot-media video { max-width:100%; max-height:100%; }
    .ot-media audio { width:min(90%, 520px); }
    .ot-media-msg { color:#bbb; padding:24px; font:14px system-ui, sans-serif; text-align:center; }
  `;
  document.head.appendChild(s);
}

class MediaInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private url: string | null = null;
  private bytes: Uint8Array | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-media";
    const mime = ctx.mime ?? "";
    if (ctx.bytes && ctx.bytes.length) {
      const blob = new Blob([ctx.bytes as BlobPart], mime ? { type: mime } : undefined);
      this.url = URL.createObjectURL(blob);
      const isAudio = mime.startsWith("audio/");
      const m = document.createElement(isAudio ? "audio" : "video") as HTMLMediaElement;
      m.src = this.url;
      m.controls = true;
      m.addEventListener("error", () => {
        wrap.textContent = "";
        const d = document.createElement("div");
        d.className = "ot-media-msg";
        d.textContent = "This media format is not supported by your browser.";
        wrap.appendChild(d);
      });
      wrap.appendChild(m);
    } else {
      const d = document.createElement("div");
      d.className = "ot-media-msg";
      d.textContent = "Nothing to play.";
      wrap.appendChild(d);
    }
    container.appendChild(wrap);
    this.wrap = wrap;
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
