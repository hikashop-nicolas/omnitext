import Psd from "@webtoon/psd";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Read-only Photoshop viewer built on @webtoon/psd (zero-dependency PSD/PSB parser). It
// renders the flattened composite to a canvas and lists the layer tree. Parsing +
// compositing are async, so the view shows a loading line first.

const STYLE_ID = "omnitext-psd-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-psd { height:100%; display:flex; overflow:hidden; background:var(--canvas); }
    .ot-psd-view { flex:1 1 auto; overflow:auto; display:flex; align-items:flex-start;
      justify-content:center; padding:16px; }
    .ot-psd-view canvas { display:block; max-width:100%; height:auto; cursor:zoom-in;
      box-shadow:0 1px 6px rgba(0,0,0,.25); background:
        conic-gradient(#0000 90deg, #8883 0 180deg, #0000 0 270deg, #8883 0) 0 0/18px 18px; }
    .ot-psd-view.is-actual canvas { max-width:none; cursor:zoom-out; }
    .ot-psd-side { flex:0 0 220px; border-left:1px solid var(--border); background:var(--chrome);
      display:flex; flex-direction:column; overflow:hidden; }
    .ot-psd-head { padding:8px 10px; border-bottom:1px solid var(--border); font:600 12px system-ui;
      color:var(--text); }
    .ot-psd-layers { flex:1 1 auto; overflow:auto; padding:4px 0; }
    .ot-psd-layer { padding:3px 10px 3px var(--ind, 10px); font:12px/1.4 system-ui, sans-serif;
      color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ot-psd-layer.is-group { font-weight:600; color:var(--muted); }
    .ot-psd-msg { margin:auto; color:var(--muted); font:14px system-ui, sans-serif;
      padding:24px; text-align:center; }
  `;
  document.head.appendChild(s);
}

interface Node {
  type: string;
  name?: string;
  children?: Node[];
}

class PsdInstance implements EditorInstance {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ot-psd";
    container.appendChild(root);
    this.root = root;

    const msg = document.createElement("div");
    msg.className = "ot-psd-msg";
    msg.textContent = "Loading…";
    root.appendChild(msg);

    void this.render(root, ctx.bytes ?? new Uint8Array());
  }

  private async render(root: HTMLElement, bytes: Uint8Array): Promise<void> {
    try {
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const psd = Psd.parse(buf);
      const pixels = await psd.composite();
      root.textContent = "";

      const view = document.createElement("div");
      view.className = "ot-psd-view";
      const canvas = document.createElement("canvas");
      canvas.width = psd.width;
      canvas.height = psd.height;
      const c2d = canvas.getContext("2d");
      c2d?.putImageData(new ImageData(new Uint8ClampedArray(pixels), psd.width, psd.height), 0, 0);
      canvas.addEventListener("click", () => view.classList.toggle("is-actual"));
      view.appendChild(canvas);

      const side = document.createElement("div");
      side.className = "ot-psd-side";
      const layerCount = countLayers((psd as unknown as Node).children ?? []);
      const head = document.createElement("div");
      head.className = "ot-psd-head";
      head.textContent = `${psd.width} × ${psd.height} · ${layerCount} layer${layerCount === 1 ? "" : "s"}`;
      const list = document.createElement("div");
      list.className = "ot-psd-layers";
      // PSD stores layers bottom-to-top; show topmost first.
      renderLayers(list, ((psd as unknown as Node).children ?? []).slice().reverse(), 0);
      side.append(head, list);

      root.append(view, side);
    } catch (e) {
      root.textContent = "";
      const m = document.createElement("div");
      m.className = "ot-psd-msg";
      m.textContent = "This PSD could not be displayed:\n" + ((e as Error)?.message ?? String(e));
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

function countLayers(nodes: Node[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "Layer") n++;
    if (node.children) n += countLayers(node.children);
  }
  return n;
}

function renderLayers(container: HTMLElement, nodes: Node[], depth: number): void {
  for (const node of nodes) {
    const isGroup = node.type === "Group";
    const row = document.createElement("div");
    row.className = isGroup ? "ot-psd-layer is-group" : "ot-psd-layer";
    row.style.setProperty("--ind", `${10 + depth * 12}px`);
    row.textContent = (isGroup ? "▸ " : "") + (node.name || "(unnamed)");
    container.appendChild(row);
    if (node.children) renderLayers(container, node.children.slice().reverse(), depth + 1);
  }
}

export const psdViewer: EditorModule = {
  create: () => new PsdInstance(),
};
