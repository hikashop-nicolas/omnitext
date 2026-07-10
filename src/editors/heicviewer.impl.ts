import libheif from "libheif-js/wasm-bundle";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only HEIC/HEIF viewer built on libheif-js (the WASM build of libheif, LGPL-3.0,
// bundled here as an unmodified artifact). It decodes the primary image to a canvas. A
// HEIC container can hold several images; we show the first (usually the primary).
// Decoding is CPU-heavy, so the view shows a loading line first.

const STYLE_ID = "omnitext-heic-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-heic { height:100%; display:flex; overflow:auto; background:var(--canvas); align-items:flex-start;
      justify-content:center; padding:16px; }
    .ot-heic canvas { display:block; max-width:100%; height:auto; cursor:zoom-in;
      box-shadow:0 1px 6px rgba(0,0,0,.25); }
    .ot-heic.is-actual { align-items:flex-start; }
    .ot-heic.is-actual canvas { max-width:none; cursor:zoom-out; }
    .ot-heic-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(image: ImageData, cb: (data: ImageData | null) => void): void;
}

class HeicInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-heic";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-heic-msg";
    msg.textContent = "Decoding…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, bytes: Uint8Array): Promise<void> {
    try {
      const decoder = new (libheif as { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } }).HeifDecoder();
      const images = decoder.decode(bytes);
      if (!images.length) throw new Error("no image found in container");
      const image = images[0];
      const w = image.get_width();
      const h = image.get_height();
      const imageData = new ImageData(w, h);
      await new Promise<void>((resolve, reject) => {
        image.display(imageData, (data) => (data ? resolve() : reject(new Error("HEIF processing error"))));
      });
      root.textContent = "";
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.putImageData(imageData, 0, 0);
      canvas.addEventListener("click", () => root.classList.toggle("is-actual"));
      root.appendChild(canvas);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-heic-msg";
      m.textContent = "This image could not be displayed:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
    }
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    this.root?.remove();
    this.root = null;
  }
}

export const heicViewer: EditorModule = {
  create: () => new HeicInstance(),
};
