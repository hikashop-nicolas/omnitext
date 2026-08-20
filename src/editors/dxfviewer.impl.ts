import { DxfViewer, isDwg } from "cadview";
import * as THREE from "three";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only 2D CAD viewer for DXF and DWG drawings, built on cadview (a fork of dxf-viewer,
// a WebGL renderer tuned for large real-world files, with DWG reading added). It renders
// entities with their layer colours and provides pan/zoom; editing is out of scope.
//
// DXF loads from a URL, so it is fed an in-memory object URL built from the document bytes.
// DWG is handed over as bytes directly: it is read in the page rather than fetched, and
// either way nothing leaves the browser.

const STYLE_ID = "omnitext-dxf-style";

/**
 * A worker to read the drawing in, or null if this browser will not make one.
 *
 * The viewer takes a factory and terminates what it gets when the load finishes, so a fresh
 * one is built per file. DXF can still be read in the page without one; DWG cannot, because
 * its parser is bundled only into the worker. That is deliberate: keeping a main-thread
 * fallback for DWG meant shipping the 1.1 MB parser twice, in two bundles that cannot share
 * a chunk, to everyone, for a browser with no worker support at all.
 */
function makeCadWorker(): Worker | null {
  try {
    return new Worker(new URL("./cad.worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    console.warn("No CAD worker available", e);
    return null;
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-dxf { position:relative; height:100%; overflow:hidden; background:var(--canvas); }
    /* dxf-viewer forces position:relative on this host and sizes its canvas to the host,
       so it needs an explicit height (absolute inset:0 collapses to the 0-height canvas). */
    .ot-dxf-canvas { width:100%; height:100%; }
    .ot-dxf-bar { position:absolute; left:12px; bottom:10px; font:12px system-ui, sans-serif;
      color:var(--muted); background:color-mix(in srgb, var(--canvas) 78%, transparent); padding:3px 8px;
      border-radius:4px; pointer-events:none; }
    .ot-dxf-layers { position:absolute; top:10px; right:10px; width:230px; max-height:calc(100% - 20px);
      z-index:2;
      display:flex; flex-direction:column; background:color-mix(in srgb, var(--canvas) 88%, transparent);
      border:1px solid var(--border); border-radius:8px; font:12px system-ui, sans-serif; overflow:hidden; }
    .ot-dxf-layers-head { display:flex; align-items:center; gap:6px; padding:6px 8px;
      border-bottom:1px solid var(--border); }
    .ot-dxf-layers-head input { flex:1; min-width:0; font:inherit; padding:3px 6px;
      border:1px solid var(--border); border-radius:5px; background:var(--surface); color:var(--text); }
    .ot-dxf-layers-head button { font:inherit; font-size:11px; padding:3px 6px; cursor:pointer;
      border:1px solid var(--border); border-radius:5px; background:var(--surface); color:var(--text); }
    .ot-dxf-layers-list { overflow:auto; padding:4px 0; }
    .ot-dxf-layers.is-folded { width:auto; }
    .ot-dxf-layers.is-folded .ot-dxf-layers-list,
    .ot-dxf-layers.is-folded .ot-dxf-layers-head input,
    .ot-dxf-layers.is-folded .ot-dxf-layers-head button:not(.ot-dxf-fold) { display:none; }
    .ot-dxf-layers.is-folded .ot-dxf-layers-head { border-bottom:0; }
    .ot-dxf-fold { flex:none; display:flex; align-items:center; justify-content:center;
      padding:4px; line-height:0; }
    .ot-dxf-fold svg { width:16px; height:16px; display:block; }
    .ot-dxf-layer { display:flex; align-items:center; gap:7px; padding:2px 9px; cursor:pointer; }
    .ot-dxf-layer:hover { background:var(--surface-hover); }
    .ot-dxf-layer span.sw { width:10px; height:10px; border-radius:2px; flex:none;
      border:1px solid color-mix(in srgb, var(--text) 30%, transparent); }
    .ot-dxf-layer span.nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text); }
    .ot-dxf-msg { position:absolute; inset:0; margin:auto; display:flex; align-items:center;
      justify-content:center; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
    /* Over the drawing, but out of the way of it: the layer takes the pointer only while an
       area is being marked, so at every other moment a drag still pans. */
    .ot-dxf-area { position:absolute; inset:0; pointer-events:none; z-index:1; }
    /* touch-action matters here: without it the browser claims a drag as a scroll gesture and
       cancels the pointer stream mid-mark, so on a phone no area can be drawn at all. */
    .ot-dxf-area.is-active { pointer-events:auto; cursor:crosshair; touch-action:none; }
    .ot-dxf-area-rect { position:absolute; border:1px dashed var(--text);
      background:color-mix(in srgb, var(--accent, #4a9eff) 12%, transparent); pointer-events:none; }
    /* Above the marking layer, so the layer list and this button stay usable while an area
       is being marked instead of being swallowed by it. */
    .ot-dxf-areabtn { position:absolute; top:10px; left:10px; width:30px; height:30px; padding:5px;
      z-index:2;
      display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--text);
      background:color-mix(in srgb, var(--canvas) 88%, transparent); border:1px solid var(--border);
      border-radius:8px; }
    .ot-dxf-areabtn svg { width:100%; height:100%; }
    .ot-dxf-areabtn.is-active { color:var(--accent, #4a9eff);
      border-color:color-mix(in srgb, var(--accent, #4a9eff) 60%, var(--border)); }
    .ot-dxf-marked { position:absolute; top:12px; left:48px; font:12px system-ui, sans-serif;
      color:var(--muted); background:color-mix(in srgb, var(--canvas) 78%, transparent);
      padding:3px 8px; border-radius:4px; pointer-events:none; }
  `;
  document.head.appendChild(s);
}


/**
 * The layer list, with a box to filter it.
 *
 * A real drawing carries a lot of layers (181 in the one this was built against), so an
 * unfiltered list is a wall rather than a control. Colour swatches because that is how
 * anyone recognises a layer: the names are the CAD operator's, not the reader's.
 */
function buildLayerPanel(
  viewer: { GetLayers?: (nonEmpty?: boolean) => Iterable<{ name: string; displayName?: string; color?: number }>;
            ShowLayer: (name: string, show: boolean) => void; Render?: () => void },
): HTMLElement | null {
  const layers = [...(viewer.GetLayers?.(true) ?? [])];
  // Nothing to choose between: one layer, or none, and the control is a box that does
  // nothing but take up the drawing.
  if (layers.length < 2) return null;

  const panel = document.createElement("div");
  panel.className = "ot-dxf-layers";
  const head = document.createElement("div");
  head.className = "ot-dxf-layers-head";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = `${layers.length}`;
  const toggleAll = document.createElement("button");
  toggleAll.type = "button";
  // Folds away to its header. The list is worth its space while choosing layers and in
  // the way while looking at the drawing, which is most of the time.
  const fold = document.createElement("button");
  fold.type = "button";
  fold.className = "ot-dxf-fold";
  fold.setAttribute("aria-expanded", "true");
  head.append(fold, filter, toggleAll);
  const list = document.createElement("div");
  list.className = "ot-dxf-layers-list";
  panel.append(head, list);

  const shown = new Map<string, boolean>(layers.map((l) => [l.name, true]));
  const rows: { row: HTMLElement; box: HTMLInputElement; name: string }[] = [];

  for (const layer of layers) {
    const row = document.createElement("label");
    row.className = "ot-dxf-layer";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = "#" + ((layer.color ?? 0xffffff) >>> 0).toString(16).padStart(6, "0");
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = layer.displayName ?? layer.name;
    nm.title = layer.name;
    row.append(box, sw, nm);
    box.addEventListener("change", () => {
      shown.set(layer.name, box.checked);
      viewer.ShowLayer(layer.name, box.checked);
      viewer.Render?.();
      refreshToggle();
    });
    list.appendChild(row);
    rows.push({ row, box, name: layer.name });
  }

  const refreshToggle = (): void => {
    // Whichever action affects more layers is the one offered: with most hidden, the
    // useful button is "show all", and offering "hide all" there does nothing anyone wants.
    const visible = [...shown.values()].filter(Boolean).length;
    toggleAll.textContent = visible > shown.size / 2 ? "none" : "all";
  };
  toggleAll.addEventListener("click", () => {
    const show = toggleAll.textContent === "all";
    for (const { box, name } of rows) {
      // Only the rows the filter is showing, so the button acts on what is on screen
      // rather than on layers the reader cannot see and did not mean to touch.
      if (box.closest(".ot-dxf-layer")?.hasAttribute("hidden")) continue;
      box.checked = show;
      shown.set(name, show);
      viewer.ShowLayer(name, show);
    }
    viewer.Render?.();
    refreshToggle();
  });
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    for (const { row, name } of rows) row.toggleAttribute("hidden", !!q && !name.toLowerCase().includes(q));
  });
  // A stack of sheets, because that is what a layer is. A caret would say "there is more
  // below", which is not what this opens.
  fold.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>';
  const setFolded = (folded: boolean): void => {
    panel.classList.toggle("is-folded", folded);
    fold.setAttribute("aria-expanded", String(!folded));
    fold.title = `${layers.length}`;
  };
  fold.addEventListener("click", () => setFolded(!panel.classList.contains("is-folded")));
  // On a phone the list is half the screen, and it opens over the drawing it is describing.
  // There it starts folded, as an icon to reach for; on a desktop there is room for both.
  setFolded(window.innerWidth < 720);

  refreshToggle();
  return panel;
}

/** The longest side of a printed area, in pixels. Detail for paper, without asking the
 * hardware for a buffer it will refuse to allocate. */
const MAX_PRINT_PX = 2400;

/**
 * A picture of the drawing that suits paper.
 *
 * A drawing meant for a dark background is light lines on black, which on paper is a black
 * rectangle: heavy on ink, and the reason CAD applications have always plotted a dark
 * drawing as dark lines on white. Inverting turns the black ground white and the light
 * lines dark; turning the hue back through half a circle keeps the colours recognisable
 * instead of making every green line magenta.
 */
function forPaper(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  invert: boolean,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  if (invert) ctx.filter = "invert(1) hue-rotate(180deg)";
  ctx.drawImage(source, 0, 0, width, height);
  return out;
}

/** Whether a six-digit hex colour is dark enough that what sits on it is drawn light. */
function isDark(hex: string): boolean {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return true;
  // Rough luminance is enough: this only decides between two treatments.
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.5;
}

/**
 * The area to print, in CSS pixels from the canvas's top-left corner.
 *
 * Kept in screen space rather than drawing coordinates because it is drawn on screen and
 * has to survive nothing: it is turned into a camera at the moment of printing, against
 * whatever view is current then.
 */
interface PrintArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Let the pointer mark out a rectangle over the drawing.
 *
 * The layer sits above the canvas and takes the pointer only while marking, so at every
 * other moment dragging still pans the drawing, which is what a drag means in a viewer.
 * Returns the current area, or null when nothing is marked.
 */
function buildAreaSelector(
  root: HTMLElement,
  onChange: (area: PrintArea | null) => void,
): { layer: HTMLElement; button: HTMLButtonElement; clear: () => void } {
  const layer = document.createElement("div");
  layer.className = "ot-dxf-area";
  const rect = document.createElement("div");
  rect.className = "ot-dxf-area-rect";
  rect.hidden = true;
  layer.appendChild(rect);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ot-dxf-areabtn";
  button.title = "Mark an area to print";
  button.setAttribute("aria-pressed", "false");
  // A dashed frame with a solid corner: the marquee this draws, not a printer, because the
  // button marks the area rather than printing it.
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" aria-hidden="true">' +
    '<path d="M3 8V5a2 2 0 0 1 2-2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" />' +
    '<path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" />' +
    '<path d="M8 8h8v8H8z" stroke-dasharray="2 2" /></svg>';

  let area: PrintArea | null = null;
  let marking = false;

  const draw = (): void => {
    if (!area) {
      rect.hidden = true;
      return;
    }
    rect.hidden = false;
    rect.style.left = `${Math.min(area.x0, area.x1)}px`;
    rect.style.top = `${Math.min(area.y0, area.y1)}px`;
    rect.style.width = `${Math.abs(area.x1 - area.x0)}px`;
    rect.style.height = `${Math.abs(area.y1 - area.y0)}px`;
  };

  const setActive = (on: boolean): void => {
    layer.classList.toggle("is-active", on);
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-pressed", String(on));
  };

  const clear = (): void => {
    area = null;
    draw();
    onChange(null);
  };

  button.addEventListener("click", () => {
    const on = !layer.classList.contains("is-active");
    setActive(on);
    // Leaving the mode keeps the area: it is what will print, and having to redraw it
    // because the mode was switched off would be its own small annoyance.
    if (on && area) clear();
  });

  layer.addEventListener("pointerdown", (e) => {
    if (!layer.classList.contains("is-active")) return;
    const box = layer.getBoundingClientRect();
    marking = true;
    layer.setPointerCapture(e.pointerId);
    area = { x0: e.clientX - box.left, y0: e.clientY - box.top, x1: e.clientX - box.left, y1: e.clientY - box.top };
    draw();
    e.preventDefault();
  });

  /** Take the far corner from wherever the pointer is now, inside the drawing. */
  const extendTo = (e: PointerEvent): void => {
    if (!area) return;
    const box = layer.getBoundingClientRect();
    area.x1 = Math.max(0, Math.min(box.width, e.clientX - box.left));
    area.y1 = Math.max(0, Math.min(box.height, e.clientY - box.top));
    draw();
  };

  layer.addEventListener("pointermove", (e) => {
    if (!marking || !area) return;
    extendTo(e);
  });

  const finish = (e: PointerEvent, released: boolean): void => {
    if (!marking) return;
    marking = false;
    try {
      layer.releasePointerCapture(e.pointerId);
    } catch {
      /* the capture is already gone */
    }
    // Only where the pointer was let go. A cancelled gesture carries no meaningful position
    // (it arrives at 0,0), and taking it as the far corner drew every area from the top-left
    // corner of the drawing.
    if (!released) {
      clear();
      return;
    }
    // Where it was let go, not where it was last seen moving: the two differ by the last of
    // the drag, and that is the corner the eye was on.
    extendTo(e);
    // A click rather than a drag: too small to be an area, and treating it as one would
    // print a sliver of the drawing scaled up to fill the page.
    if (area && (Math.abs(area.x1 - area.x0) < 8 || Math.abs(area.y1 - area.y0) < 8)) {
      clear();
      return;
    }
    draw();
    onChange(area);
    // The area is marked; staying in marking mode would only get in the way of looking at
    // it, and the button is still there to mark another.
    setActive(false);
  };
  layer.addEventListener("pointerup", (e) => finish(e, true));
  layer.addEventListener("pointercancel", (e) => finish(e, false));

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!area && !layer.classList.contains("is-active")) return;
    setActive(false);
    clear();
    e.stopPropagation();
  });

  return { layer, button, clear };
}

class DxfInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private viewer: DxfViewer | null = null;
  private url: string | null = null;
  private area: PrintArea | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-dxf";
    container.appendChild(root);
    this.root = root;
    const msg = document.createElement("div");
    msg.className = "ot-dxf-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);
    void this.render(root, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, bytes: Uint8Array): Promise<void> {
    try {
      const canvasHost = document.createElement("div");
      canvasHost.className = "ot-dxf-canvas";
      root.textContent = "";
      root.appendChild(canvasHost);

      // dxf-viewer measures the container once at construction; if the editor pane
      // hasn't been laid out yet the height is 0 and nothing is visible. Wait for a
      // real size first.
      await waitForSize(canvasHost);

      // Match the app background so the drawing sits on the same surface. dxf-viewer
      // expects a THREE.Color (it calls .getHex() on it), not a raw number.
      const bg = getComputedStyle(document.body).getPropertyValue("--canvas").trim() || "#1e1e1e";
      const viewer = new DxfViewer(canvasHost, {
        autoResize: true,
        colorCorrection: true,
        clearColor: new THREE.Color(bg || "#1e1e1e"),
      });
      this.viewer = viewer;

      // Reading happens in a worker so a big drawing does not freeze the page. Without one
      // the viewer still reads it here, slowly, which beats not opening the file at all.
      const worker = makeCadWorker();
      const workerFactory = worker ? () => worker : null;

      const dwg = isDwg(bytes);
      let unsupported: Record<string, number> = {};
      let missingLinks: string[] = [];
      if (dwg) {
        if (!workerFactory) throw new Error("Opening a DWG needs a browser that supports workers.");
        // The bytes are transferred to the worker, so this hands over a copy: the document
        // still owns its own, and saving or reopening it must still work afterwards.
        ({ unsupported, missingLinks } = await viewer.LoadDwg({
          bytes: bytes.slice().buffer,
          workerFactory,
        }));
      } else {
        this.url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/dxf" }));
        await viewer.Load({ url: this.url, workerFactory });
      }

      const bar = document.createElement("div");
      bar.className = "ot-dxf-bar";
      const layers = [...(viewer.GetLayers?.() ?? [])];
      // What could not be drawn is said out loud. A CAD drawing missing its dimensions
      // still looks like a drawing, so a viewer that stays quiet is trusted for something
      // it did not render.
      const missing = Object.entries(unsupported);
      const left = missing.length
        ? ` · ${missing.reduce((n, [, c]) => n + c, 0)} not drawn (${missing.map(([t]) => t.toLowerCase()).join(", ")})`
        : "";
      // A linked picture is not a gap in this viewer: the drawing names a file that is not
      // in it, and no browser can go and get it. Said differently so it is not read as one.
      const linked = missingLinks.length
        ? ` · ${missingLinks.length} linked image${missingLinks.length === 1 ? "" : "s"} not in the file`
        : "";
      bar.textContent = `${dwg ? "DWG" : "DXF"} · ${layers.length} layer${layers.length === 1 ? "" : "s"} · scroll to zoom, drag to pan${left}${linked}`;
      root.appendChild(bar);

      const panel = buildLayerPanel(viewer as never);
      if (panel) root.appendChild(panel);

      // Marking an area changes what the print button does, so it says so rather than
      // leaving the difference to be discovered on paper.
      const marked = document.createElement("div");
      marked.className = "ot-dxf-marked";
      marked.hidden = true;
      marked.textContent = "Print will cover the marked area";

      const selector = buildAreaSelector(root, (area) => {
        this.area = area;
        marked.hidden = !area;
      });
      root.appendChild(selector.layer);
      root.appendChild(selector.button);
      root.appendChild(marked);
      // Escape reaches the viewer only if something here can be focused.
      root.tabIndex = -1;
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-dxf-msg";
      m.textContent = "This DXF could not be displayed:\n" + ((e as Error)?.message ?? String(e));
      root.appendChild(m);
    }
  }

  /**
   * The drawing as a picture of it, for the printer.
   *
   * The canvas cannot simply be printed where it sits: it is sized for the pane it lives in,
   * so on paper it would be a screenshot, and the app's chrome sits on top of it. This
   * re-renders the marked area, or the whole current view when none is marked, through a
   * camera built for the page rather than for the screen.
   */
  printable(): HTMLElement | null {
    const image = this.capture();
    if (!image) return null;
    const sheet = document.createElement("div");
    sheet.className = "ot-dxf-print";
    sheet.appendChild(image);
    return sheet;
  }

  /** Re-render the print area at print resolution. Null if there is nothing to render. */
  private capture(): HTMLImageElement | null {
    const viewer = this.viewer;
    if (!viewer?.HasRenderer?.()) return null;
    const renderer = viewer.GetRenderer();
    const camera = viewer.GetCamera();
    const scene = viewer.GetScene();
    const canvas = viewer.GetCanvas();
    if (!renderer || !camera || !scene || !canvas) return null;

    const box = canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    const area = this.area ?? { x0: 0, y0: 0, x1: box.width, y1: box.height };

    // Screen pixels to the drawing's own coordinates, through the camera showing it now.
    const at = (x: number, y: number): THREE.Vector3 =>
      new THREE.Vector3((x / box.width) * 2 - 1, -((y / box.height) * 2 - 1), 0).unproject(camera);
    const a = at(area.x0, area.y0);
    const b = at(area.x1, area.y1);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    if (!(width > 0) || !(height > 0)) return null;

    // Paper holds far more detail than a screen, and this is a drawing: printing the pixels
    // that were on screen would print the aliasing along with them. Capped so that a huge
    // pane does not ask for a texture the hardware will refuse.
    const scale = Math.min(3, MAX_PRINT_PX / Math.max(area.x1 - area.x0, area.y1 - area.y0));
    const pw = Math.max(1, Math.round(Math.abs(area.x1 - area.x0) * scale));
    const ph = Math.max(1, Math.round(Math.abs(area.y1 - area.y0) * scale));

    const printCamera = camera.clone();
    printCamera.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, camera.position.z);
    printCamera.left = -width / 2;
    printCamera.right = width / 2;
    printCamera.top = height / 2;
    printCamera.bottom = -height / 2;
    printCamera.updateProjectionMatrix();

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    // The entities were coloured for the background they are on, and cannot be recoloured
    // now without rebuilding every material. So the page is reached from whichever end
    // lands on white: a dark drawing is rendered on black and inverted, a light one is
    // rendered on white as it is. Either way nothing prints a page-sized field of ink.
    const invert = isDark(clear.getHexString());
    let out: HTMLCanvasElement;
    try {
      // The drawing buffer is only cleared when the page is composited, so the picture has
      // to be taken in the same task as the render: nothing here may wait.
      renderer.setPixelRatio(1);
      renderer.setSize(pw, ph, false);
      renderer.setClearColor(invert ? 0x000000 : 0xffffff, 1);
      renderer.render(scene, printCamera);
      out = forPaper(canvas, pw, ph, invert);
    } finally {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(size.x, size.y, false);
      renderer.setClearColor(clear, clearAlpha);
      viewer.Render();
    }

    const img = document.createElement("img");
    img.src = out.toDataURL("image/png");
    img.alt = "The drawing";
    return img;
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    try {
      this.viewer?.Destroy();
    } catch {
      /* ignore */
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.viewer = null;
    this.root?.remove();
    this.root = null;
  }
}

// Resolve once the element has a non-zero size (or after a short timeout as a backstop).
function waitForSize(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (el.clientHeight > 0 && el.clientWidth > 0) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ro.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const ro = new ResizeObserver(() => {
      if (el.clientHeight > 0 && el.clientWidth > 0) finish();
    });
    ro.observe(el);
    const timer = setTimeout(finish, 2000);
  });
}

export const dxfViewer: EditorModule = {
  create: () => new DxfInstance(),
};
