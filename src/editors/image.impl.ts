import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only image viewer. Shows the bytes via a blob URL in an <img>; click toggles
// fit-to-width vs actual size. SVG is rendered through <img> too (its scripts stay inert).

const STYLE_ID = "omnitext-image-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-image { height:100%; overflow:auto; background:var(--canvas);
      display:flex; align-items:center; justify-content:center; }
    .ot-image img { display:block; max-width:100%; max-height:100%; object-fit:contain; cursor:zoom-in; }
    .ot-image.is-actual { align-items:flex-start; justify-content:flex-start; }
    .ot-image.is-actual img { max-width:none; max-height:none; cursor:zoom-out; }
    .ot-image-msg { color:var(--muted); padding:24px; font:14px system-ui, sans-serif; }
  `;
  document.head.appendChild(s);
}

class ImageInstance implements EditorInstance {
  private wrap: HTMLElement | null = null;
  private url: string | null = null;
  private bytes: Uint8Array | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.bytes = ctx.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-image";
    if (ctx.bytes && ctx.bytes.length) {
      const blob = new Blob([ctx.bytes as BlobPart], ctx.mime ? { type: ctx.mime } : undefined);
      this.url = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = "";
      img.addEventListener("click", () => wrap.classList.toggle("is-actual"));
      img.addEventListener("error", () => {
        wrap.textContent = "";
        wrap.append(el("This image could not be displayed by your browser."));
      });
      wrap.appendChild(img);
    } else {
      wrap.append(el("Nothing to display."));
    }
    container.appendChild(wrap);
    this.wrap = wrap;
  }

  getText(): string {
    return "";
  }

  getBytes(): Uint8Array | undefined {
    return this.bytes ?? undefined; // read-only: hand back the original for history snapshots
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

function el(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "ot-image-msg";
  d.textContent = text;
  return d;
}

export const imageEditor: EditorModule = {
  create: () => new ImageInstance(),
};
