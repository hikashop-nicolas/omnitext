import { DxfViewer } from "dxf-viewer";
import * as THREE from "three";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only 2D CAD viewer for DXF drawings, built on dxf-viewer (a WebGL renderer tuned
// for large real-world files). It renders entities with their layer colours and provides
// pan/zoom. Editing is out of scope. dxf-viewer loads from a URL, so we feed it an
// in-memory object URL built from the document bytes (nothing leaves the browser).

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
    .ot-dxf-msg { position:absolute; inset:0; margin:auto; display:flex; align-items:center;
      justify-content:center; color:var(--muted); font:14px system-ui, sans-serif; padding:24px;
      text-align:center; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
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

      this.url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/dxf" }));
      await viewer.Load({ url: this.url });

      const bar = document.createElement("div");
      bar.className = "ot-dxf-bar";
      const layers = viewer.GetLayers?.() ?? [];
      bar.textContent = `DXF · ${layers.length} layer${layers.length === 1 ? "" : "s"} · scroll to zoom, drag to pan`;
      root.appendChild(bar);
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
