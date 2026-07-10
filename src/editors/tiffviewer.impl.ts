import UTIF from "utif";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only TIFF viewer built on UTIF.js (pure-JS TIFF codec). A TIFF can hold several
// pages/images; each IFD is decoded to RGBA and drawn to its own canvas, stacked with a
// page label. Editing is out of scope.

const STYLE_ID = "omnitext-tiff-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-tiff { height:100%; overflow:auto; background:var(--canvas); color:var(--text); }
    .ot-tiff-doc { display:flex; flex-direction:column; align-items:center; gap:18px; padding:20px; }
    .ot-tiff-page { display:flex; flex-direction:column; align-items:center; gap:6px; max-width:100%; }
    .ot-tiff-page canvas { display:block; max-width:100%; height:auto; box-shadow:0 1px 6px rgba(0,0,0,.25);
      background:
        conic-gradient(#0000 90deg, #8883 0 180deg, #0000 0 270deg, #8883 0) 0 0/18px 18px; }
    .ot-tiff-cap { font:12px system-ui, sans-serif; color:var(--muted); }
    .ot-tiff-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

class TiffInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-tiff";
    container.appendChild(root);
    this.root = root;
    try {
      const bytes = ctx.bytes ?? new Uint8Array();
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const ifds = UTIF.decode(buf);
      // width/height are only populated after decodeImage; some IFDs are EXIF/thumbnail
      // sub-directories that fail to decode as images, so decode each defensively first.
      const pages: { ifd: (typeof ifds)[number]; w: number; h: number }[] = [];
      for (const ifd of ifds) {
        try {
          UTIF.decodeImage(buf, ifd);
          const w = Number(ifd.width);
          const h = Number(ifd.height);
          if (w > 0 && h > 0) pages.push({ ifd, w, h });
        } catch {
          /* not an image directory; skip */
        }
      }
      if (!pages.length) throw new Error("no image pages found");

      const doc = document.createElement("div");
      doc.className = "ot-tiff-doc";
      pages.forEach(({ ifd, w, h }, i) => {
        const rgba = UTIF.toRGBA8(ifd);
        const page = document.createElement("div");
        page.className = "ot-tiff-page";
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas
          .getContext("2d")
          ?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
        page.appendChild(canvas);
        const cap = document.createElement("div");
        cap.className = "ot-tiff-cap";
        cap.textContent = pages.length > 1 ? `Page ${i + 1} of ${pages.length} · ${w} × ${h}` : `${w} × ${h}`;
        page.appendChild(cap);
        doc.appendChild(page);
      });
      root.appendChild(doc);
    } catch (e) {
      const m = document.createElement("div");
      m.className = "ot-tiff-msg";
      m.textContent = "This TIFF could not be displayed:\n" + ((e as Error)?.message ?? String(e));
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

export const tiffViewer: EditorModule = {
  create: () => new TiffInstance(),
};
