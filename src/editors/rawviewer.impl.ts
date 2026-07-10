import exifr from "exifr";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only viewer for camera RAW files (CR2/CR3, NEF, ARW, DNG, RW2, ORF, RAF, …). A
// full RAW demosaic needs a multi-megabyte decoder; instead this shows the JPEG preview
// the camera embeds in the file plus the EXIF shot metadata (camera, lens, exposure),
// via exifr (pure JS). Everything is read in the browser.

const STYLE_ID = "omnitext-raw-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-raw { height:100%; display:flex; overflow:hidden; background:var(--canvas); color:var(--text); }
    .ot-raw-view { flex:1 1 auto; overflow:auto; display:flex; align-items:center; justify-content:center;
      padding:16px; }
    .ot-raw-view img { max-width:100%; max-height:100%; height:auto; box-shadow:0 1px 6px rgba(0,0,0,.25); }
    .ot-raw-view .ot-raw-none { color:var(--muted); font:14px system-ui, sans-serif; text-align:center; }
    .ot-raw-side { flex:0 0 260px; border-left:1px solid var(--border); background:var(--chrome);
      overflow:auto; padding:14px 16px; }
    .ot-raw-side h3 { font:600 11px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.04em;
      color:var(--muted); margin:0 0 8px; }
    .ot-raw-meta { font:13px/1.5 system-ui, sans-serif; }
    .ot-raw-meta dt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.03em;
      margin:9px 0 1px; }
    .ot-raw-meta dd { margin:0; word-break:break-word; }
    .ot-raw-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

function fmtExposure(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "";
  return n >= 1 ? `${n}s` : `1/${Math.round(1 / n)}s`;
}

class RawInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private url: string | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-raw";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-raw-msg";
    msg.textContent = "Reading…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array(), ctx.filename ?? "");
  }

  private async render(root: HTMLElement, bytes: Uint8Array, filename: string): Promise<void> {
    try {
      const buf = bytes.slice().buffer;
      const [thumb, meta] = await Promise.all([
        exifr.thumbnail(buf).catch(() => undefined),
        exifr.parse(buf, true).catch(() => ({}) as Record<string, unknown>),
      ]);
      root.textContent = "";

      const view = document.createElement("div");
      view.className = "ot-raw-view";
      if (thumb && thumb.byteLength) {
        this.url = URL.createObjectURL(new Blob([thumb as BlobPart], { type: "image/jpeg" }));
        const img = document.createElement("img");
        img.src = this.url;
        img.alt = filename;
        view.appendChild(img);
      } else {
        const none = document.createElement("div");
        none.className = "ot-raw-none";
        none.textContent = "No embedded preview in this RAW file.\nShot metadata is shown on the right.";
        view.appendChild(none);
      }

      const side = document.createElement("div");
      side.className = "ot-raw-side";
      const m = (meta ?? {}) as Record<string, unknown>;
      const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "RAW").toUpperCase();
      const fields: [string, string][] = [
        ["Format", ext],
        ["Camera", [m.Make, m.Model].filter(Boolean).join(" ")],
        ["Lens", String(m.LensModel ?? m.LensInfo ?? "")],
        ["Dimensions", m.ImageWidth && m.ImageHeight ? `${m.ImageWidth} × ${m.ImageHeight}` : ""],
        ["ISO", m.ISO != null ? String(m.ISO) : ""],
        ["Aperture", m.FNumber != null ? `f/${m.FNumber}` : ""],
        ["Shutter", fmtExposure(m.ExposureTime)],
        ["Focal length", m.FocalLength != null ? `${m.FocalLength} mm` : ""],
        ["Taken", m.DateTimeOriginal ? new Date(m.DateTimeOriginal as string).toLocaleString() : ""],
        ["Software", String(m.Software ?? "")],
      ];
      const h = document.createElement("h3");
      h.textContent = "Metadata";
      side.appendChild(h);
      const dl = document.createElement("dl");
      dl.className = "ot-raw-meta";
      for (const [label, value] of fields) {
        if (!value) continue;
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        dl.append(dt, dd);
      }
      side.appendChild(dl);

      root.append(view, side);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-raw-msg";
      m.textContent = "This RAW file could not be read:\n" + ((e as Error)?.message ?? String(e));
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
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.root?.remove();
    this.root = null;
  }
}

export const rawViewer: EditorModule = {
  create: () => new RawInstance(),
};
