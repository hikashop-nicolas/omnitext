import * as opentype from "opentype.js";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only font viewer built on opentype.js. Renders a specimen (pangram at several
// sizes), a name/metadata table, and a scrollable glyph grid. TTF, OTF and WOFF are
// supported; WOFF2 needs a separate decompressor and is not handled here.

const STYLE_ID = "omnitext-font-style";
const PANGRAM = "The quick brown fox jumps over the lazy dog";
const SPECIMEN_SIZES = [64, 40, 28, 20, 14];

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-font { height:100%; display:flex; overflow:hidden; background:var(--canvas); color:var(--text); }
    .ot-font-main { flex:1 1 auto; overflow:auto; padding:20px 24px; }
    .ot-font-title { font:600 20px system-ui, sans-serif; margin:0 0 2px; }
    .ot-font-sub { font:13px system-ui, sans-serif; color:var(--muted); margin:0 0 18px; }
    .ot-font-specimen canvas { display:block; max-width:100%; margin:0 0 6px; }
    .ot-font-hr { border:0; border-top:1px solid var(--border); margin:20px 0; }
    .ot-font-h { font:600 12px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.04em;
      color:var(--muted); margin:0 0 10px; }
    .ot-font-glyphs { display:grid; grid-template-columns:repeat(auto-fill, minmax(54px, 1fr)); gap:6px; }
    .ot-font-glyph { border:1px solid var(--border); border-radius:4px; background:var(--surface);
      aspect-ratio:1; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .ot-font-glyph canvas { display:block; }
    .ot-font-side { flex:0 0 260px; border-left:1px solid var(--border); background:var(--chrome);
      overflow:auto; padding:14px 16px; }
    .ot-font-meta { font:13px/1.5 system-ui, sans-serif; }
    .ot-font-meta dt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.03em;
      margin:10px 0 1px; }
    .ot-font-meta dd { margin:0; word-break:break-word; }
    .ot-font-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

// opentype name tables map a key to { en: "...", ... }; take English, else the first value.
function name(names: Record<string, Record<string, string>>, key: string): string {
  const entry = names?.[key];
  if (!entry) return "";
  return entry.en ?? Object.values(entry)[0] ?? "";
}

function drawGlyph(glyph: opentype.Glyph, unitsPerEm: number, box: number): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = box * dpr;
  canvas.height = box * dpr;
  canvas.style.width = `${box}px`;
  canvas.style.height = `${box}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text") || "#000";
  const size = box * 0.72;
  const baseline = box * 0.74;
  // Centre the glyph horizontally using its advance width.
  const advance = ((glyph.advanceWidth ?? unitsPerEm) / unitsPerEm) * size;
  const x = Math.max(0, (box - advance) / 2);
  try {
    glyph.getPath(x, baseline, size).draw(ctx as unknown as CanvasRenderingContext2D);
  } catch {
    /* some glyphs (e.g. composite/empty) may not draw; skip */
  }
  return canvas;
}

class FontInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-font";
    container.appendChild(root);
    this.root = root;
    this.render(root, ctx.bytes ?? new Uint8Array(), ctx.filename ?? "");
  }

  private render(root: HTMLElement, bytes: Uint8Array, filename: string): void {
    try {
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const font = opentype.parse(buf);
      const names = font.names as unknown as Record<string, Record<string, string>>;
      root.textContent = "";

      const main = document.createElement("div");
      main.className = "ot-font-main";

      const family = name(names, "fontFamily") || filename || "Font";
      const subfamily = name(names, "fontSubfamily") || "Regular";
      const title = document.createElement("h1");
      title.className = "ot-font-title";
      title.textContent = family;
      const sub = document.createElement("p");
      sub.className = "ot-font-sub";
      const ext = (filename.match(/\.(ttf|otf|woff2?|ttc)$/i)?.[1] ?? "").toUpperCase();
      sub.textContent = [subfamily, ext, `${font.glyphs.length} glyphs`, `${font.unitsPerEm} upm`]
        .filter(Boolean)
        .join(" · ");
      main.append(title, sub);

      const specimen = document.createElement("div");
      specimen.className = "ot-font-specimen";
      for (const size of SPECIMEN_SIZES) {
        specimen.appendChild(this.specimenLine(font, size));
      }
      main.appendChild(specimen);

      main.appendChild(el("hr", "ot-font-hr"));
      main.appendChild(el("div", "ot-font-h", "Glyphs"));
      const grid = document.createElement("div");
      grid.className = "ot-font-glyphs";
      const limit = Math.min(font.glyphs.length, 400);
      for (let i = 0; i < limit; i++) {
        const cell = document.createElement("div");
        cell.className = "ot-font-glyph";
        const glyph = font.glyphs.get(i);
        cell.title = glyph.name || `#${i}`;
        cell.appendChild(drawGlyph(glyph, font.unitsPerEm, 48));
        grid.appendChild(cell);
      }
      main.appendChild(grid);
      if (font.glyphs.length > limit) {
        main.appendChild(el("p", "ot-font-sub", `Showing the first ${limit} of ${font.glyphs.length} glyphs.`));
      }

      const side = document.createElement("div");
      side.className = "ot-font-side";
      const dl = document.createElement("dl");
      dl.className = "ot-font-meta";
      const fields: [string, string][] = [
        ["Family", family],
        ["Style", subfamily],
        ["Full name", name(names, "fullName")],
        ["Version", name(names, "version")],
        ["Designer", name(names, "designer")],
        ["Manufacturer", name(names, "manufacturer")],
        ["Copyright", name(names, "copyright")],
        ["Trademark", name(names, "trademark")],
        ["License", name(names, "license") || name(names, "licenseURL")],
      ];
      for (const [label, value] of fields) {
        if (!value) continue;
        dl.appendChild(el("dt", "", label));
        dl.appendChild(el("dd", "", value));
      }
      side.appendChild(dl);

      root.append(main, side);
    } catch (e) {
      root.textContent = "";
      const woff2 = /\.woff2$/i.test(filename);
      const m = el(
        "div",
        "ot-font-msg",
        woff2
          ? "WOFF2 fonts are Brotli-compressed and can't be previewed here yet.\nDecompress to TTF/OTF/WOFF to view."
          : "This font could not be displayed:\n" + ((e as Error)?.message ?? String(e)),
      );
      root.appendChild(m);
    }
  }

  private specimenLine(font: opentype.Font, size: number): HTMLCanvasElement {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pad = 4;
    const path = font.getPath(PANGRAM, 0, 0, size);
    const bb = path.getBoundingBox();
    const width = Math.ceil(bb.x2 - bb.x1) + pad * 2;
    const height = Math.ceil(size * 1.35);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width) * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${Math.max(1, width)}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text") || "#000";
      font.draw(ctx as unknown as CanvasRenderingContext2D, PANGRAM, pad, size, size);
    }
    return canvas;
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

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export const fontViewer: EditorModule = {
  create: () => new FontInstance(),
};
