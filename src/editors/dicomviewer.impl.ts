import dicomParser from "dicom-parser";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only DICOM (.dcm) viewer built on dicom-parser. It renders uncompressed monochrome
// (with window/level) and RGB images to a canvas and lists key metadata. Compressed
// transfer syntaxes (JPEG/JPEG2000/JPEG-LS) need extra codecs and are reported, not shown.

const STYLE_ID = "omnitext-dicom-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-dicom { height:100%; display:flex; overflow:hidden; background:var(--canvas); color:var(--text); }
    .ot-dicom-view { flex:1 1 auto; overflow:auto; display:flex; align-items:center; justify-content:center;
      padding:16px; background:#000; }
    .ot-dicom-view canvas { max-width:100%; max-height:100%; height:auto; image-rendering:pixelated; }
    .ot-dicom-side { flex:0 0 250px; border-left:1px solid var(--border); background:var(--chrome);
      overflow:auto; padding:14px 16px; }
    .ot-dicom-side h3 { font:600 11px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.04em;
      color:var(--muted); margin:0 0 8px; }
    .ot-dicom-meta { font:13px/1.5 system-ui, sans-serif; }
    .ot-dicom-meta dt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.03em;
      margin:9px 0 1px; }
    .ot-dicom-meta dd { margin:0; word-break:break-word; }
    .ot-dicom-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

// Uncompressed transfer syntaxes we can render (implicit / explicit VR little-endian).
const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2",
  "1.2.840.10008.1.2.1",
  "1.2.840.10008.1.2.2", // explicit VR big-endian (rare)
]);

class DicomInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-dicom";
    container.appendChild(root);
    this.root = root;
    try {
      const bytes = ctx.bytes ?? new Uint8Array();
      const ds = dicomParser.parseDicom(bytes);
      const view = document.createElement("div");
      view.className = "ot-dicom-view";
      const canvas = this.renderImage(ds, bytes);
      if (canvas) view.appendChild(canvas);
      else {
        const m = document.createElement("div");
        m.className = "ot-dicom-msg";
        const ts = ds.string("x00020010") || "";
        m.textContent = UNCOMPRESSED.has(ts)
          ? "This image's pixel format isn't supported yet."
          : "This DICOM uses a compressed transfer syntax that needs an extra codec.\nMetadata is shown on the right.";
        view.appendChild(m);
      }
      root.append(view, this.renderMeta(ds));
    } catch (e) {
      const m = document.createElement("div");
      m.className = "ot-dicom-msg";
      m.textContent = "This DICOM file could not be read:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
    }
  }

  private renderImage(
    ds: ReturnType<typeof dicomParser.parseDicom>,
    bytes: Uint8Array,
  ): HTMLCanvasElement | null {
    const ts = ds.string("x00020010") || "1.2.840.10008.1.2";
    const pixelEl = ds.elements.x7fe00010;
    if (!UNCOMPRESSED.has(ts) || !pixelEl || pixelEl.encapsulatedPixelData) return null;

    const rows = ds.uint16("x00280010") ?? 0;
    const cols = ds.uint16("x00280011") ?? 0;
    if (!rows || !cols) return null;
    const samples = ds.uint16("x00280002") ?? 1;
    const bitsAllocated = ds.uint16("x00280100") ?? 16;
    const pixelRep = ds.uint16("x00280103") ?? 0;
    const photometric = ds.string("x00280004") || "MONOCHROME2";
    const slope = ds.floatString("x00281053") || 1;
    const intercept = ds.floatString("x00281052") || 0;

    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const out = ctx.createImageData(cols, rows);

    const base = bytes.byteOffset + pixelEl.dataOffset;
    const count = rows * cols;

    if (samples === 3 && photometric.startsWith("RGB")) {
      const src = new Uint8Array(bytes.buffer, base, count * 3);
      for (let i = 0; i < count; i++) {
        out.data[i * 4] = src[i * 3];
        out.data[i * 4 + 1] = src[i * 3 + 1];
        out.data[i * 4 + 2] = src[i * 3 + 2];
        out.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return canvas;
    }

    // Monochrome: read raw samples, apply rescale + window/level to 8-bit.
    let read: (i: number) => number;
    if (bitsAllocated <= 8) {
      const src = new Uint8Array(bytes.buffer, base, count);
      read = (i) => src[i];
    } else if (pixelRep === 1) {
      const src = new Int16Array(bytes.buffer, base, count);
      read = (i) => src[i];
    } else {
      const src = new Uint16Array(bytes.buffer, base, count);
      read = (i) => src[i];
    }

    let center = ds.floatString("x00281050");
    let width = ds.floatString("x00281051");
    if (!width) {
      // No window in the file: derive from the actual min/max after rescale.
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < count; i++) {
        const v = read(i) * slope + intercept;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      center = (hi + lo) / 2;
      width = Math.max(1, hi - lo);
    }
    const invert = photometric === "MONOCHROME1";
    const lowEdge = (center as number) - 0.5 - (width - 1) / 2;
    for (let i = 0; i < count; i++) {
      const v = read(i) * slope + intercept;
      let g: number;
      if (v <= lowEdge) g = 0;
      else if (v > lowEdge + width) g = 255;
      else g = Math.round(((v - lowEdge) / width) * 255);
      if (invert) g = 255 - g;
      out.data[i * 4] = g;
      out.data[i * 4 + 1] = g;
      out.data[i * 4 + 2] = g;
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  private renderMeta(ds: ReturnType<typeof dicomParser.parseDicom>): HTMLElement {
    const side = document.createElement("div");
    side.className = "ot-dicom-side";
    const rows = ds.uint16("x00280010");
    const cols = ds.uint16("x00280011");
    const frames = ds.intString("x00280008");
    const fields: [string, string][] = [
      ["Modality", ds.string("x00080060") || ""],
      ["Study", ds.string("x00081030") || ""],
      ["Series", ds.string("x0008103e") || ""],
      ["Body part", ds.string("x00180015") || ""],
      ["Patient", ds.string("x00100010") || ""],
      ["Patient ID", ds.string("x00100020") || ""],
      ["Date", ds.string("x00080020") || ""],
      ["Dimensions", rows && cols ? `${cols} × ${rows}${frames && frames > 1 ? ` × ${frames}` : ""}` : ""],
      ["Manufacturer", ds.string("x00080070") || ""],
    ];
    const h = document.createElement("h3");
    h.textContent = "DICOM tags";
    side.appendChild(h);
    const dl = document.createElement("dl");
    dl.className = "ot-dicom-meta";
    for (const [label, value] of fields) {
      if (!value) continue;
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    }
    side.appendChild(dl);
    return side;
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

export const dicomViewer: EditorModule = {
  create: () => new DicomInstance(),
};
