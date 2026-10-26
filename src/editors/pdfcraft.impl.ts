import { EngineError, openPdf, type PdfDocument, type TextBlock } from "craftbridge/pdf";
import PdfWorker from "craftbridge/pdf/worker?worker";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { t } from "../i18n";
import { currentPage, fitZoom, hitBlock, layoutPages, renderScale, visibleRange, type Layout, type PageSize } from "./pdfcraft-layout";

const STYLE_ID = "omnitext-pdfcraft-style";
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const GAP = 12;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pc { height:100%; display:flex; flex-direction:column; background:var(--canvas); color:var(--text); }
    .ot-pc-bar { display:flex; align-items:center; gap:2px; padding:4px 6px; overflow-x:auto;
      border-bottom:1px solid var(--border); background:var(--surface); }
    .ot-pc-bar button { display:flex; align-items:center; justify-content:center; flex:0 0 auto; width:36px; height:36px;
      padding:0; color:inherit; background:transparent; border:1px solid transparent; border-radius:8px; cursor:pointer; }
    .ot-pc-bar button:hover:not(:disabled) { border-color:var(--border); }
    .ot-pc-bar button:focus-visible, .ot-pc-edit-bar button:focus-visible { outline:2px solid currentColor; outline-offset:1px; }
    .ot-pc-bar button:disabled { opacity:.45; cursor:default; }
    .ot-pc-bar .sep { width:1px; align-self:stretch; background:var(--border); margin:0 2px; }
    .ot-pc-pill { position:absolute; right:10px; bottom:10px; z-index:4; padding:3px 9px; border-radius:999px;
      background:var(--surface); color:var(--muted); border:1px solid var(--border); font:12px system-ui, sans-serif;
      pointer-events:none; opacity:.92; }
    .ot-pc-body { flex:1 1 auto; min-height:0; position:relative; display:flex; }
    .ot-pc-scroll { flex:1 1 auto; min-height:0; overflow:auto; position:relative; touch-action:pan-x pan-y; }
    .ot-pc-content { position:relative; transform-origin:0 0; }
    .ot-pc-slot { position:absolute; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.35); }
    .ot-pc-slot canvas { display:block; width:100%; height:100%; }
    .ot-pc-edit { position:absolute; z-index:5; box-sizing:border-box; resize:none; margin:0; padding:1px 2px;
      font-family:system-ui, sans-serif; line-height:1.15; color:#000; background:rgba(255,255,230,.97);
      border:1.5px solid #2a6df4; border-radius:2px; }
    .ot-pc-edit-bar { position:absolute; z-index:6; display:flex; gap:6px; }
    .ot-pc-edit-bar button { display:flex; align-items:center; justify-content:center; width:40px; height:36px; padding:0;
      border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; }
    .ot-pc-msg { margin:32px auto; max-width:420px; padding:16px; text-align:center; font:14px system-ui, sans-serif; }
    .ot-pc-msg form { display:flex; flex-direction:column; gap:8px; }
    .ot-pc-msg input { font:inherit; padding:6px 8px; border:1px solid var(--border); border-radius:6px;
      background:var(--surface); color:var(--text); min-width:0; flex:1 1 auto; }
    .ot-pc-msg button { font:inherit; padding:6px 12px; border-radius:6px; border:1px solid var(--border);
      background:var(--surface); color:var(--text); cursor:pointer; }
    .ot-pc-err { color:#d33; margin-top:8px; }
  `;
  document.head.appendChild(s);
}

// Lucide-style outline icons (24 px grid, 2 px stroke), the same look as the app's own toolbar.
const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/><path d="M11 8v6"/>',
  fit: '<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  blank: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>',
  delete: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
} as const;

function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Slot {
  box: HTMLElement;
  canvas: HTMLCanvasElement | null;
  /** Zoom and edit generation the canvas was drawn at. */
  drawn: { zoom: number; gen: number } | null;
}

class PdfCraftInstance implements EditorInstance {
  private root!: HTMLElement;
  private bar!: HTMLElement;
  private scroller!: HTMLElement;
  private content!: HTMLElement;
  private pageLabel!: HTMLElement;
  private doc: PdfDocument | null = null;
  private original: Uint8Array = new Uint8Array();
  private onChange: (() => void) | undefined;
  private sizes: PageSize[] = [];
  private layout: Layout = { tops: [], widths: [], heights: [], total: 0 };
  private slots: Slot[] = [];
  private zoom = 1;
  private fitted = false;
  private userZoomed = false;
  private gen = 0;
  private edited = false;
  private disposed = false;
  private rendering = false;
  private raf = 0;
  private blockCache = new Map<number, TextBlock[]>();
  private editing: { page: number; block: TextBlock; area: HTMLTextAreaElement; bar: HTMLElement } | null = null;
  private buttons: Record<string, HTMLButtonElement> = {};
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number; cx: number; cy: number } | null = null;
  private tap: { x: number; y: number; time: number; moved: boolean } | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.onChange = ctx.onChange;
    this.original = ctx.bytes ?? new Uint8Array();
    this.root = el("div", "ot-pc");
    this.bar = el("div", "ot-pc-bar");
    this.scroller = el("div", "ot-pc-scroll");
    this.content = el("div", "ot-pc-content");
    this.scroller.appendChild(this.content);
    this.pageLabel = el("div", "ot-pc-pill");
    this.pageLabel.hidden = true;
    const body = el("div", "ot-pc-body");
    body.append(this.scroller, this.pageLabel);
    this.root.append(this.bar, body);
    container.appendChild(this.root);
    this.buildBar();
    this.scroller.addEventListener("scroll", () => this.scheduleRender(), { passive: true });
    this.scroller.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.scroller.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.scroller.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.scroller.addEventListener("pointercancel", (e) => this.onPointerEnd(e));
    this.scroller.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    window.addEventListener("resize", this.onResize);
    void this.open();
  }

  private onResize = (): void => {
    if (!this.fitted) return;
    if (this.userZoomed) this.applyLayout();
    else this.fitWidth();
  };

  // ------------------------------------------------------------------ toolbar

  private button(key: string, glyph: keyof typeof ICONS, label: string, onClick: () => void): HTMLButtonElement {
    const b = el("button");
    b.type = "button";
    b.innerHTML = icon(glyph);
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    this.buttons[key] = b;
    this.bar.appendChild(b);
    return b;
  }

  private buildBar(): void {
    const sep = () => this.bar.appendChild(el("span", "sep"));
    this.button("undo", "undo", t("pdfcraft.undo"), () => void this.history("undo"));
    this.button("redo", "redo", t("pdfcraft.redo"), () => void this.history("redo"));
    sep();
    this.button("out", "zoomOut", t("pdfcraft.zoomOut"), () => this.zoomBy(1 / 1.25));
    this.button("fit", "fit", t("pdfcraft.fit"), () => this.fitWidth());
    this.button("in", "zoomIn", t("pdfcraft.zoomIn"), () => this.zoomBy(1.25));
    sep();
    this.button("rotate", "rotate", t("pdfcraft.rotate"), () => void this.pageOp("rotate"));
    this.button("up", "up", t("pdfcraft.moveUp"), () => void this.pageOp("up"));
    this.button("down", "down", t("pdfcraft.moveDown"), () => void this.pageOp("down"));
    this.button("blank", "blank", t("pdfcraft.addBlank"), () => void this.pageOp("blank"));
    this.button("delete", "delete", t("pdfcraft.deletePage"), () => void this.pageOp("delete"));
    for (const b of Object.values(this.buttons)) b.disabled = true;
  }

  private async refreshHistory(): Promise<void> {
    if (!this.doc) return;
    const h = await this.doc.history();
    this.buttons.undo!.disabled = !h.undo;
    this.buttons.redo!.disabled = !h.redo;
  }

  // ------------------------------------------------------------------ opening

  private message(content: HTMLElement | string): void {
    this.content.replaceChildren();
    this.content.style.height = "";
    const box = el("div", "ot-pc-msg");
    if (typeof content === "string") box.textContent = content;
    else box.appendChild(content);
    this.content.appendChild(box);
  }

  private async open(password?: string, wrong = false): Promise<void> {
    try {
      this.doc = await openPdf(this.original, { password, worker: new PdfWorker() });
    } catch (e) {
      if (this.disposed) return;
      if (e instanceof EngineError && (e.code === "needs-password" || e.code === "wrong-password")) {
        this.askPassword(wrong || e.code === "wrong-password");
      } else {
        this.message(t("pdfcraft.failed", { message: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (this.disposed) {
      this.doc.close();
      return;
    }
    await this.loadPages();
    this.fitWidth();
    for (const b of Object.values(this.buttons)) b.disabled = false;
    await this.refreshHistory();
  }

  private askPassword(wrong: boolean): void {
    const form = el("form");
    form.appendChild(el("div", undefined, t("pdfcraft.password")));
    const row = el("div");
    row.style.cssText = "display:flex;gap:8px";
    const input = el("input");
    input.type = "password";
    input.autocomplete = "off";
    input.setAttribute("aria-label", t("pdfcraft.password"));
    const go = el("button", undefined, t("pdfcraft.open"));
    go.type = "submit";
    row.append(input, go);
    form.appendChild(row);
    if (wrong) form.appendChild(el("div", "ot-pc-err", t("pdfcraft.wrongPassword")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.open(input.value);
    });
    this.message(form);
    input.focus();
  }

  private async loadPages(): Promise<void> {
    if (!this.doc) return;
    const sizes: PageSize[] = [];
    for (let i = 0; i < this.doc.pageCount; i++) {
      const s = await this.doc.pageSize(i);
      sizes.push(s ? { w: s[0], h: s[1] } : { w: 612, h: 792 });
    }
    this.sizes = sizes;
    this.blockCache.clear();
    this.buildSlots();
  }

  // ------------------------------------------------------------------ layout and drawing

  private buildSlots(): void {
    this.cancelEdit();
    this.content.replaceChildren();
    this.slots = this.sizes.map(() => {
      const box = el("div", "ot-pc-slot");
      this.content.appendChild(box);
      return { box, canvas: null, drawn: null };
    });
    this.applyLayout();
  }

  private applyLayout(): void {
    this.layout = layoutPages(this.sizes, this.zoom, GAP);
    const widest = this.layout.widths.reduce((m, w) => Math.max(m, w), 0);
    // Pages sit in the middle of a content box that is at least as wide as the view, so a page
    // wider than the view scrolls from its left edge instead of being cut off.
    const width = Math.max(widest + 2 * GAP, this.scroller.clientWidth);
    this.content.style.width = `${width}px`;
    this.content.style.height = `${this.layout.total}px`;
    this.slots.forEach((slot, i) => {
      const s = slot.box.style;
      s.top = `${this.layout.tops[i]}px`;
      s.width = `${this.layout.widths[i]}px`;
      s.height = `${this.layout.heights[i]}px`;
      s.left = `${(width - this.layout.widths[i]!) / 2}px`;
    });
    this.updatePageLabel();
    this.scheduleRender();
  }

  private updatePageLabel(): void {
    if (!this.sizes.length) return;
    const n = currentPage(this.layout, this.scroller.scrollTop, this.scroller.clientHeight) + 1;
    this.pageLabel.hidden = false;
    this.pageLabel.textContent = `${n} / ${this.sizes.length}`;
    this.pageLabel.setAttribute("aria-label", t("pdfcraft.page", { n, total: this.sizes.length }));
  }

  private fitWidth(): void {
    this.fitted = true;
    this.userZoomed = false;
    this.setZoom(fitZoom(this.scroller.clientWidth || 360, this.sizes), false);
  }

  private zoomBy(factor: number): void {
    this.userZoomed = true;
    this.setZoom(this.zoom * factor, true);
  }

  private setZoom(next: number, keepCenter: boolean, anchor?: { cx: number; cy: number }): void {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (zoom === this.zoom && this.layout.tops.length) return;
    const before = this.zoom;
    // The document point under the anchor (default: the middle of the view) stays under it.
    const cx = anchor?.cx ?? this.scroller.clientWidth / 2;
    const cy = anchor?.cy ?? this.scroller.clientHeight / 2;
    const docY = (this.scroller.scrollTop + cy) / before;
    const docX = (this.scroller.scrollLeft + cx) / before;
    this.zoom = zoom;
    this.cancelEdit();
    this.applyLayout();
    if (keepCenter || anchor) {
      this.scroller.scrollTop = docY * zoom - cy;
      this.scroller.scrollLeft = docX * zoom - cx;
    }
  }

  private scheduleRender(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.updatePageLabel();
      void this.pump();
    });
  }

  /** Draws the pages near the viewport that are missing or stale, one at a time, and frees far ones. */
  private async pump(): Promise<void> {
    if (this.rendering || !this.doc || this.disposed) return;
    this.rendering = true;
    try {
      for (;;) {
        const viewport = this.scroller.clientHeight;
        const range = visibleRange(this.layout, this.scroller.scrollTop, viewport, viewport);
        this.release(visibleRange(this.layout, this.scroller.scrollTop, viewport, viewport * 3));
        if (!range) return;
        const stale = (i: number) => {
          const d = this.slots[i]?.drawn;
          return !d || d.zoom !== this.zoom || d.gen !== this.gen;
        };
        let target = -1;
        for (let i = range[0]; i <= range[1]; i++) if (stale(i)) (target = i, i = range[1] + 1);
        if (target < 0) return;
        const ok = await this.draw(target);
        if (!ok) return;
      }
    } finally {
      this.rendering = false;
    }
  }

  private release(keep: [number, number] | null): void {
    this.slots.forEach((slot, i) => {
      if (slot.canvas && (!keep || i < keep[0] || i > keep[1])) {
        slot.canvas.width = 0;
        slot.canvas.remove();
        slot.canvas = null;
        slot.drawn = null;
      }
    });
  }

  private async draw(page: number): Promise<boolean> {
    const doc = this.doc;
    const slot = this.slots[page];
    const size = this.sizes[page];
    if (!doc || !slot || !size) return false;
    const zoom = this.zoom;
    const gen = this.gen;
    try {
      const scale = renderScale(zoom, window.devicePixelRatio || 1, size);
      const r = await doc.render(page, scale);
      if (this.disposed || zoom !== this.zoom || gen !== this.gen || this.slots[page] !== slot) return true;
      const canvas = el("canvas");
      canvas.width = r.width;
      canvas.height = r.height;
      const c2d = canvas.getContext("2d");
      if (!c2d) return false;
      c2d.putImageData(new ImageData(new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer), r.width, r.height), 0, 0);
      slot.canvas?.remove();
      slot.box.appendChild(canvas);
      slot.canvas = canvas;
      slot.drawn = { zoom, gen };
      return true;
    } catch (e) {
      if (!this.disposed) console.warn("pdfcraft: page", page + 1, "did not draw", e);
      // Do not retry this page until something changes, or a bad page would spin forever.
      slot.drawn = { zoom, gen };
      return true;
    }
  }

  // ------------------------------------------------------------------ touch and wheel

  private onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.userZoomed = true;
    const rect = this.scroller.getBoundingClientRect();
    this.setZoom(this.zoom * Math.exp(-e.deltaY / 200), true, { cx: e.clientX - rect.left, cy: e.clientY - rect.top });
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.tap = { x: e.clientX, y: e.clientY, time: Date.now(), moved: false };
    else this.tap = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const rect = this.scroller.getBoundingClientRect();
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom, cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top };
      this.scroller.style.touchAction = "none";
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 8) this.tap.moved = true;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const ratio = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / this.pinch.dist;
      // Scale the drawn pages while the fingers are down, and draw them again at the end.
      this.content.style.transformOrigin = `${this.scroller.scrollLeft + this.pinch.cx}px ${this.scroller.scrollTop + this.pinch.cy}px`;
      this.content.style.transform = `scale(${Math.min(MAX_ZOOM / this.pinch.zoom, Math.max(MIN_ZOOM / this.pinch.zoom, ratio))})`;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const tap = this.tap;
    this.onPointerEnd(e);
    if (tap && !tap.moved && Date.now() - tap.time < 500 && !this.pinch) void this.onTap(e.clientX, e.clientY);
  }

  private onPointerEnd(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.tap = null;
    if (this.pinch && this.pointers.size < 2) {
      const pinch = this.pinch;
      this.pinch = null;
      const ratio = parseFloat(/scale\(([\d.]+)\)/.exec(this.content.style.transform)?.[1] ?? "1") || 1;
      this.content.style.transform = "";
      this.scroller.style.touchAction = "";
      this.userZoomed = true;
      this.setZoom(pinch.zoom * ratio, true, { cx: pinch.cx, cy: pinch.cy });
    }
  }

  // ------------------------------------------------------------------ editing text

  private async blocks(page: number): Promise<TextBlock[]> {
    const cached = this.blockCache.get(page);
    if (cached) return cached;
    const list = this.doc ? await this.doc.textBlocks(page) : [];
    this.blockCache.set(page, list);
    return list;
  }

  private async onTap(clientX: number, clientY: number): Promise<void> {
    if (!this.doc || this.editing) return;
    const page = this.slots.findIndex((s) => {
      const r = s.box.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    });
    if (page < 0) return;
    const r = this.slots[page]!.box.getBoundingClientRect();
    const x = (clientX - r.left) / this.zoom;
    const y = (clientY - r.top) / this.zoom;
    const blocks = await this.blocks(page);
    const hit = hitBlock(blocks.map((b) => (b.invisible ? null : b.view)), x, y);
    if (hit >= 0) this.startEdit(page, blocks[hit]!);
  }

  private startEdit(page: number, block: TextBlock): void {
    if (!block.view) return;
    const [x0, y0, x1, y1] = block.view;
    const z = this.zoom;
    const slot = this.slots[page]!.box;
    const area = el("textarea", "ot-pc-edit");
    area.value = block.text;
    area.spellcheck = false;
    area.style.left = `${x0 * z - 2}px`;
    area.style.top = `${y0 * z - 2}px`;
    area.style.width = `${Math.max((x1 - x0) * z + 8, 80)}px`;
    area.style.height = `${Math.max((y1 - y0) * z + 6, 28)}px`;
    area.style.fontSize = `${Math.max(10, block.size * z)}px`;
    const bar = el("div", "ot-pc-edit-bar");
    bar.style.left = `${x0 * z - 2}px`;
    bar.style.top = `${Math.max((y1 - y0) * z + 6, 28) + y0 * z + 4}px`;
    const done = el("button");
    const cancel = el("button");
    done.type = cancel.type = "button";
    done.innerHTML = icon("check");
    cancel.innerHTML = icon("close");
    done.title = done.ariaLabel = t("pdfcraft.done");
    cancel.title = cancel.ariaLabel = t("pdfcraft.cancel");
    done.addEventListener("click", () => void this.finishEdit(true));
    cancel.addEventListener("click", () => void this.finishEdit(false));
    bar.append(done, cancel);
    slot.append(area, bar);
    // Grow to show all the text, up to a limit; the buttons follow the box.
    const grown = Math.min(Math.max(area.scrollHeight + 4, parseFloat(area.style.height)), 360);
    area.style.height = `${grown}px`;
    bar.style.top = `${y0 * z - 2 + grown + 4}px`;
    this.editing = { page, block, area, bar };
    area.focus();
  }

  private cancelEdit(): void {
    if (!this.editing) return;
    this.editing.area.remove();
    this.editing.bar.remove();
    this.editing = null;
  }

  private async finishEdit(commit: boolean): Promise<void> {
    const edit = this.editing;
    if (!edit || !this.doc) return;
    const text = edit.area.value;
    this.cancelEdit();
    if (!commit || text === edit.block.text) return;
    try {
      await this.doc.editTextBlock(edit.page, edit.block.index, text);
      this.afterEdit([edit.page]);
    } catch (e) {
      this.message(t("pdfcraft.failed", { message: e instanceof Error ? e.message : String(e) }));
    }
  }

  // ------------------------------------------------------------------ page operations and history

  private afterEdit(pages: number[] | "all"): void {
    this.edited = true;
    this.gen++;
    if (pages === "all") this.blockCache.clear();
    else for (const p of pages) this.blockCache.delete(p);
    this.onChange?.();
    void this.refreshHistory();
    this.scheduleRender();
  }

  private currentIndex(): number {
    return currentPage(this.layout, this.scroller.scrollTop, this.scroller.clientHeight);
  }

  private async pageOp(op: "rotate" | "up" | "down" | "blank" | "delete"): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const page = this.currentIndex();
    const count = this.sizes.length;
    try {
      if (op === "rotate") await doc.rotatePages([page], 90);
      else if (op === "up" && page > 0) await doc.movePages([page], page - 1);
      else if (op === "down" && page < count - 1) await doc.movePages([page], page + 1);
      else if (op === "blank") {
        const s = this.sizes[page] ?? { w: 612, h: 792 };
        await doc.insertBlankPage(page + 1, s.w, s.h);
      } else if (op === "delete" && count > 1) await doc.deletePages([page]);
      else return;
    } catch (e) {
      this.message(t("pdfcraft.failed", { message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    await this.reloadPages(op === "up" ? page - 1 : op === "down" ? page + 1 : op === "blank" ? page + 1 : Math.min(page, this.sizes.length));
  }

  private async history(which: "undo" | "redo"): Promise<void> {
    if (!this.doc) return;
    try {
      await (which === "undo" ? this.doc.undo() : this.doc.redo());
    } catch (e) {
      this.message(t("pdfcraft.failed", { message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    await this.reloadPages(this.currentIndex());
  }

  /** The page list may have changed: read it again, redraw, and come back to `page`. */
  private async reloadPages(page: number): Promise<void> {
    const before = this.scroller.scrollTop;
    await this.loadPages();
    // A turned page can be wider than the view: fit again unless the person chose a zoom.
    if (!this.userZoomed) this.setZoom(fitZoom(this.scroller.clientWidth || 360, this.sizes), false);
    this.afterEdit("all");
    const target = Math.max(0, Math.min(page, this.sizes.length - 1));
    this.scroller.scrollTop = this.layout.tops[target] !== undefined ? this.layout.tops[target]! - GAP : before;
  }

  // ------------------------------------------------------------------ EditorInstance

  getText(): string {
    return "";
  }

  async getBytes(): Promise<Uint8Array> {
    if (!this.doc || !this.edited) return this.original;
    return this.doc.save();
  }

  async printableFile(): Promise<{ bytes: Uint8Array; mime: string }> {
    return { bytes: await this.getBytes(), mime: "application/pdf" };
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.cancelEdit();
    this.release(null);
    this.doc?.close();
    this.doc = null;
    this.root?.remove();
  }
}

export const pdfCraftEditor: EditorModule = {
  create: () => new PdfCraftInstance(),
};
