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
      display:flex; flex-direction:column; background:color-mix(in srgb, var(--canvas) 88%, transparent);
      border:1px solid var(--border); border-radius:8px; font:12px system-ui, sans-serif; overflow:hidden; }
    .ot-dxf-layers-head { display:flex; align-items:center; gap:6px; padding:6px 8px;
      border-bottom:1px solid var(--border); }
    .ot-dxf-layers-head input { flex:1; min-width:0; font:inherit; padding:3px 6px;
      border:1px solid var(--border); border-radius:5px; background:var(--surface); color:var(--text); }
    .ot-dxf-layers-head button { font:inherit; font-size:11px; padding:3px 6px; cursor:pointer;
      border:1px solid var(--border); border-radius:5px; background:var(--surface); color:var(--text); }
    .ot-dxf-layers-list { overflow:auto; padding:4px 0; }
    .ot-dxf-layer { display:flex; align-items:center; gap:7px; padding:2px 9px; cursor:pointer; }
    .ot-dxf-layer:hover { background:var(--surface-hover); }
    .ot-dxf-layer span.sw { width:10px; height:10px; border-radius:2px; flex:none;
      border:1px solid color-mix(in srgb, var(--text) 30%, transparent); }
    .ot-dxf-layer span.nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text); }
    .ot-dxf-msg { position:absolute; inset:0; margin:auto; display:flex; align-items:center;
      justify-content:center; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
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
  if (layers.length === 0) return null;

  const panel = document.createElement("div");
  panel.className = "ot-dxf-layers";
  const head = document.createElement("div");
  head.className = "ot-dxf-layers-head";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = `${layers.length}`;
  const toggleAll = document.createElement("button");
  toggleAll.type = "button";
  head.append(filter, toggleAll);
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
  refreshToggle();
  return panel;
}

class DxfInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private viewer: DxfViewer | null = null;
  private url: string | null = null;

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

      const dwg = isDwg(bytes);
      let unsupported: Record<string, number> = {};
      if (dwg) {
        ({ unsupported } = await viewer.LoadDwg({ bytes }));
      } else {
        this.url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/dxf" }));
        await viewer.Load({ url: this.url });
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
      bar.textContent = `${dwg ? "DWG" : "DXF"} · ${layers.length} layer${layers.length === 1 ? "" : "s"} · scroll to zoom, drag to pan${left}`;
      root.appendChild(bar);

      const panel = buildLayerPanel(viewer as never);
      if (panel) root.appendChild(panel);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-dxf-msg";
      m.textContent = "This DXF could not be displayed:\n" + ((e as Error)?.message ?? String(e));
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
