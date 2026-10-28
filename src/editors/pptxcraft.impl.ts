import { unzipSync, strFromU8 } from "fflate";
import { EngineError, deckFontUrls, openDeck, type DeckSession, type Overlay, type SelectedShape } from "craftbridge/deck";
import DeckWorker from "craftbridge/deck/worker?worker";
import type { EditorInstance, EditorMountContext, EditorModule, HostAPI } from "../core/types";
import { t } from "../i18n";
import { formDialog } from "./pdfcraft-tools";
import { base64, colorMenu, el, icon, iconButton, popupMenu, type IconName } from "./pptxcraft-ui";

// The presentation editor on DeckCraft's engine. The engine (wasm, in a worker) owns the document, the undo history and the
// pointer tools; this file draws the chrome around it: the slide, its selection handles and caret, the slide strip, the
// toolbars. Every change is an engine command, so one finished command is one undo step.

const STYLE_ID = "omnitext-pptxcraft-style";
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const THUMB_W = 152;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-px { height:100%; display:flex; flex-direction:column; background:var(--canvas); color:var(--text); position:relative; outline:none; }
    .ot-px-bar, .ot-px-sub, .ot-px-bottom { flex:0 0 auto; display:flex; align-items:center; gap:6px; padding:6px 8px; overflow-x:auto;
      border-bottom:1px solid var(--border); background:var(--surface); scrollbar-width:none; }
    .ot-px-sub { background:var(--canvas); }
    .ot-px-bottom { border-bottom:0; border-top:1px solid var(--border); }
    .ot-px-bar .btn, .ot-px-sub .btn, .ot-px-bottom .btn { flex:0 0 auto; position:relative; }
    .ot-px .btn.on { background:var(--accent); border-color:var(--accent); color:var(--accent-fg); }
    .ot-px .btn:disabled { opacity:.45; cursor:default; }
    .ot-px .sep { flex:0 0 1px; width:1px; align-self:stretch; background:var(--border); margin:0 2px; }
    .ot-px [hidden] { display:none !important; }
    .ot-px-body { flex:1 1 auto; min-height:0; display:flex; position:relative; }
    .ot-px-side { flex:0 0 ${THUMB_W + 28}px; overflow-y:auto; padding:10px 8px; border-right:1px solid var(--border); background:var(--surface);
      display:flex; flex-direction:column; gap:10px; }
    @media (max-width:720px) { .ot-px-side { position:absolute; z-index:9; top:0; bottom:0; left:0; box-shadow:4px 0 16px rgba(0,0,0,.35); } .ot-px-side.closed { display:none; } }
    @media (min-width:721px) { .ot-px-side.closed { display:none; } }
    .ot-px-thumb { position:relative; display:flex; gap:6px; align-items:flex-start; cursor:pointer; }
    .ot-px-thumb > span { flex:0 0 16px; font:12px system-ui, sans-serif; color:var(--muted); text-align:right; padding-top:2px; }
    .ot-px-thumb .frame { border:2px solid transparent; border-radius:4px; line-height:0; background:#fff; overflow:hidden; }
    .ot-px-thumb.on .frame { border-color:var(--accent); }
    .ot-px-thumb canvas { width:${THUMB_W}px; display:block; }
    .ot-px-thumb.drop { outline:2px dashed var(--accent); }
    .ot-px-main { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
    .ot-px-stage { flex:1 1 auto; min-height:0; overflow:auto; display:flex; padding:16px; touch-action:pan-x pan-y; }
    .ot-px-slide { position:relative; margin:auto; flex:0 0 auto; background:#fff; box-shadow:0 1px 6px rgba(0,0,0,.4); user-select:none; }
    .ot-px-slide canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
    .ot-px-ov { position:absolute; inset:0; width:100%; height:100%; overflow:visible; touch-action:none; }
    .ot-px-caret { animation:ot-px-blink 1.1s steps(1) infinite; }
    @keyframes ot-px-blink { 50% { opacity:0; } }
    @media (prefers-reduced-motion:reduce) { .ot-px-caret { animation:none; } }
    .ot-px-notes { flex:0 0 auto; border-top:1px solid var(--border); background:var(--surface); display:flex; }
    .ot-px-notes textarea { flex:1; height:84px; resize:vertical; margin:6px; padding:6px 8px; font:13px system-ui, sans-serif; color:var(--text);
      background:var(--canvas); border:1px solid var(--border); border-radius:7px; }
    .ot-px-bottom .grow { flex:1 1 auto; }
    .ot-px-bottom span { color:var(--muted); font:13px system-ui, sans-serif; white-space:nowrap; }
    .ot-px-input { position:absolute; left:-9999px; top:0; width:1px; height:1px; opacity:0; resize:none; border:0; padding:0; }
    .ot-px-menu { position:absolute; z-index:20; display:flex; flex-direction:column; min-width:170px; padding:4px; border-radius:10px;
      background:var(--surface); color:var(--text); border:1px solid var(--border); box-shadow:0 6px 20px rgba(0,0,0,.4); }
    .ot-px-menu button { display:flex; align-items:center; text-align:left; padding:9px 12px; border:0; border-radius:7px; background:none; color:inherit;
      font:14px system-ui, sans-serif; cursor:pointer; }
    .ot-px-menu button:hover, .ot-px-menu button:focus-visible, .ot-px-menu button.on { background:var(--canvas); }
    .ot-px-swatches { display:grid; grid-template-columns:repeat(6, 28px); gap:6px; padding:6px; }
    .ot-px-swatch { width:28px; height:28px; border-radius:6px; border:1px solid var(--border); padding:0; cursor:pointer; }
    .ot-px-custom { position:relative; padding:8px 12px; font:14px system-ui, sans-serif; cursor:pointer; }
    .ot-px-custom input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; border:0; padding:0; }
    .ot-px-stripe { position:absolute; left:8px; right:8px; bottom:4px; height:4px; border-radius:2px; border:1px solid var(--border); }
    .ot-px-show { position:fixed; inset:0; z-index:60; background:#000; display:flex; align-items:center; justify-content:center; cursor:none; }
    .ot-px-show canvas { max-width:100%; max-height:100%; }
    .ot-px-msg { margin:32px auto; max-width:420px; padding:16px; text-align:center; font:14px system-ui, sans-serif; }
  `;
  document.head.appendChild(s);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A hex colour (#rrggbb) from the slide's pixels under a CSS colour name or value, for the colour stripes. */
const SHAPE_PRESETS: [string, string][] = [
  ["rect", "shapeRect"],
  ["roundRect", "shapeRound"],
  ["ellipse", "shapeEllipse"],
  ["triangle", "shapeTriangle"],
  ["diamond", "shapeDiamond"],
  ["rightArrow", "shapeArrow"],
  ["star5", "shapeStar"],
];

const LAYOUTS: [string, string][] = [
  ["titleAndContent", "layoutContent"],
  ["title", "layoutTitle"],
  ["sectionHeader", "layoutSection"],
  ["twoContent", "layoutTwo"],
  ["titleOnly", "layoutTitleOnly"],
  ["blank", "layoutBlank"],
];

type Tool = "select" | "textBox" | { shape: string };

class PptxCraftInstance implements EditorInstance {
  private root!: HTMLElement;
  private bar!: HTMLElement;
  private sub!: HTMLElement;
  private side!: HTMLElement;
  private stage!: HTMLElement;
  private slideEl!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private svg!: SVGSVGElement;
  private notesWrap!: HTMLElement;
  private notes!: HTMLTextAreaElement;
  private input!: HTMLTextAreaElement;
  private counter!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private buttons: Record<string, HTMLButtonElement> = {};
  private subButtons: Record<string, HTMLButtonElement> = {};

  private session: DeckSession | null = null;
  private onChange: () => void = () => undefined;
  private disposed = false;
  private busyEl: HTMLElement | null = null;
  private busyTimer = 0;

  private ov: Overlay = { open: false };
  private slideW = 960;
  private slideH = 540;
  private zoom = 1;
  private fitting = true;
  private dpr = 1;
  private renderToken = 0;
  private renderedKey = "";
  private lastRenderMs = 0;
  private lastRevision = -1;
  private chain: Promise<unknown> = Promise.resolve();
  private tool: Tool = "select";
  private dragging = false;
  private pendingDrag: { x: number; y: number; mods: { shift: boolean; alt: boolean; cmd: boolean } } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };
  private hoverBusy = false;
  private thumbs: HTMLElement[] = [];
  private thumbDirty = new Set<number>();
  private thumbPump = false;
  private thumbSlides = 0;
  private notesFor = -1;
  private resizeObserver: ResizeObserver | null = null;
  private enterAt = 0;
  private fontsLoaded = new Set<string>();
  private hansLikely = false;
  private opened: Promise<void> = Promise.resolve();
  private original: Uint8Array = new Uint8Array();

  constructor(private readonly host: HostAPI) {}

  // ------------------------------------------------------------------ mounting

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.onChange = ctx.onChange;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.root = el("div", "ot-px");
    this.root.tabIndex = -1;
    this.bar = el("div", "ot-px-bar");
    this.sub = el("div", "ot-px-sub");
    this.sub.hidden = true;
    const body = el("div", "ot-px-body");
    this.side = el("div", "ot-px-side");
    const main = el("div", "ot-px-main");
    this.stage = el("div", "ot-px-stage");
    this.slideEl = el("div", "ot-px-slide");
    this.canvas = el("canvas");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "ot-px-ov");
    this.slideEl.append(this.canvas, this.svg);
    this.stage.appendChild(this.slideEl);
    this.notesWrap = el("div", "ot-px-notes");
    this.notesWrap.hidden = true;
    this.notes = el("textarea");
    this.notes.placeholder = t("pptxcraft.notesHint");
    this.notes.setAttribute("aria-label", t("pptxcraft.notes"));
    this.notes.addEventListener("change", () => void this.setNotes());
    this.notesWrap.appendChild(this.notes);
    main.append(this.stage, this.notesWrap);
    body.append(this.side, main);
    this.input = el("textarea", "ot-px-input");
    this.input.setAttribute("aria-label", t("pptxcraft.typing"));
    this.input.autocapitalize = "off";
    this.input.spellcheck = false;
    this.fileInput = el("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => void this.pickedPicture());
    const bottom = this.buildBottom();
    this.root.append(this.bar, this.sub, body, bottom, this.input, this.fileInput);
    container.appendChild(this.root);
    this.buildBar();
    this.buildSub();
    this.side.classList.toggle("closed", window.innerWidth <= 720);
    this.wire();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitting) this.fit();
    });
    this.resizeObserver.observe(this.stage);
    this.original = ctx.bytes ?? new Uint8Array();
    this.opened = this.open(this.original, ctx.filename ?? "presentation.pptx");
  }

  private beginBusy(): void {
    this.endBusy();
    this.busyTimer = window.setTimeout(() => {
      const box = el("div", "ot-loading");
      box.setAttribute("role", "status");
      box.append(el("span", "ot-loading-spinner"), el("span", "ot-loading-label", t("loading.opening")));
      this.root.querySelector(".ot-px-body")?.appendChild(box);
      this.busyEl = box;
    }, 250);
  }

  private endBusy(): void {
    window.clearTimeout(this.busyTimer);
    this.busyEl?.remove();
    this.busyEl = null;
  }

  private async open(bytes: Uint8Array, name: string): Promise<void> {
    this.beginBusy();
    try {
      this.session = await openDeck({ worker: new DeckWorker() });
      if (this.disposed) {
        this.session.close();
        return;
      }
      await this.session.load(name, bytes.slice());
      await this.scanFonts(bytes);
      await this.refresh(true);
      this.fit();
      this.syncSlides();
    } catch (e) {
      if (!this.disposed) this.fail(e);
    } finally {
      this.endBusy();
    }
  }

  /** Loads the Korean or Simplified Chinese face the first time `text` needs it. */
  private async needFonts(text: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    const want: [string, string][] = [];
    if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text)) want.push(["hangul", deckFontUrls.hangul]);
    if (/[\u4e00-\u9fff]/.test(text) && this.hansLikely) want.push(["hans", deckFontUrls.hans]);
    for (const [key, url] of want) {
      if (this.fontsLoaded.has(key)) continue;
      this.fontsLoaded.add(key);
      try {
        const r = await fetch(url);
        if (r.ok) await session.addFont(new Uint8Array(await r.arrayBuffer()));
      } catch {
        this.fontsLoaded.delete(key);
      }
    }
  }

  /** The slides' own text, read once to see which faces the file needs. */
  private async scanFonts(bytes: Uint8Array): Promise<void> {
    try {
      const files = unzipSync(bytes, { filter: (f) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(f.name) });
      const xml = Object.values(files).map((u) => strFromU8(u)).join("\n");
      this.hansLikely = /lang="zh-(CN|SG|Hans)/i.test(xml) || !/[\u3040-\u30ff]/.test(xml);
      await this.needFonts(xml);
    } catch {
      /* an unreadable archive is the engine's to report */
    }
  }

  private fail(e: unknown): void {
    this.slideEl.replaceChildren(el("div", "ot-px-msg", t("pptxcraft.failed", { message: message(e) })));
    this.slideEl.style.cssText = "";
  }

  // ------------------------------------------------------------------ toolbars

  private button(name: IconName, title: string, run: () => void, into: HTMLElement = this.bar): HTMLButtonElement {
    const b = iconButton(name, title, run);
    into.appendChild(b);
    return b;
  }

  private sepTo(into: HTMLElement): void {
    into.appendChild(el("span", "sep"));
  }

  private buildBar(): void {
    const b = this.bar;
    this.button("slides", t("pptxcraft.slides"), () => this.side.classList.toggle("closed"));
    this.sepTo(b);
    this.buttons.undo = this.button("undo", t("pptxcraft.undo"), () => void this.cmd("edit.undo"));
    this.buttons.redo = this.button("redo", t("pptxcraft.redo"), () => void this.cmd("edit.redo"));
    this.sepTo(b);
    this.buttons.select = this.button("select", t("pptxcraft.select"), () => this.setTool("select"));
    this.buttons.text = this.button("text", t("pptxcraft.textBox"), () => this.setTool("textBox"));
    this.buttons.shapes = this.button("shapes", t("pptxcraft.shapes"), () => this.shapesMenu());
    this.buttons.picture = this.button("image", t("pptxcraft.picture"), () => this.fileInput.click());
    this.buttons.table = this.button("table", t("pptxcraft.table"), () => void this.insertTable());
    this.sepTo(b);
    this.buttons.newSlide = this.button("slideNew", t("pptxcraft.newSlide"), () => this.newSlideMenu());
    this.buttons.dupSlide = this.button("copy", t("pptxcraft.duplicateSlide"), () => void this.cmd("slide.duplicate", {}, true));
    this.buttons.delSlide = this.button("trash", t("pptxcraft.deleteSlide"), () => void this.cmd("slide.delete", {}, true));
    this.buttons.up = this.button("up", t("pptxcraft.moveUp"), () => void this.moveSlide(-1));
    this.buttons.down = this.button("down", t("pptxcraft.moveDown"), () => void this.moveSlide(1));
    this.sepTo(b);
    this.buttons.present = this.button("present", t("pptxcraft.present"), () => void this.present());
    this.buttons.notes = this.button("notes", t("pptxcraft.notes"), () => this.toggleNotes());
  }

  private colorButton(name: IconName, title: string, run: (anchor: HTMLButtonElement) => void): HTMLButtonElement {
    const b = this.button(name, title, () => run(b), this.sub);
    const stripe = el("span", "ot-px-stripe");
    stripe.style.background = "var(--muted)";
    b.appendChild(stripe);
    return b;
  }

  private buildSub(): void {
    const s = this.sub;
    const sb = this.subButtons;
    sb.bold = this.button("bold", t("pptxcraft.bold"), () => void this.cmd("format.bold"), s);
    sb.italic = this.button("italic", t("pptxcraft.italic"), () => void this.cmd("format.italic"), s);
    sb.underline = this.button("underline", t("pptxcraft.underline"), () => void this.cmd("format.underline"), s);
    sb.larger = this.button("larger", t("pptxcraft.larger"), () => void this.cmd("format.grow"), s);
    sb.smaller = this.button("smaller", t("pptxcraft.smaller"), () => void this.cmd("format.shrink"), s);
    sb.textColor = this.colorButton("textColor", t("pptxcraft.textColor"), (a) =>
      colorMenu(this.root, a, { custom: t("pptxcraft.custom") }, (c) => c && void this.cmd("format.color", { color: c })),
    );
    sb.alignLeft = this.button("alignLeft", t("pptxcraft.alignLeft"), () => void this.cmd("format.align", { align: "left" }), s);
    sb.alignCenter = this.button("alignCenter", t("pptxcraft.alignCenter"), () => void this.cmd("format.align", { align: "center" }), s);
    sb.alignRight = this.button("alignRight", t("pptxcraft.alignRight"), () => void this.cmd("format.align", { align: "right" }), s);
    sb.bullets = this.button("bullets", t("pptxcraft.bullets"), () => void this.cmd("format.bullets"), s);
    this.sepTo(s);
    sb.fill = this.colorButton("fill", t("pptxcraft.fill"), (a) =>
      colorMenu(this.root, a, { none: t("pptxcraft.noFill"), custom: t("pptxcraft.custom") }, (c) => void this.cmd("shape.fill", c ? { color: c } : { none: true })),
    );
    sb.line = this.colorButton("line", t("pptxcraft.outline"), (a) =>
      colorMenu(this.root, a, { none: t("pptxcraft.noLine"), custom: t("pptxcraft.custom") }, (c) => void this.cmd("shape.line", c ? { color: c } : { none: true })),
    );
    sb.toFront = this.button("toFront", t("pptxcraft.toFront"), () => void this.cmd("arrange.bringToFront"), s);
    sb.toBack = this.button("toBack", t("pptxcraft.toBack"), () => void this.cmd("arrange.sendToBack"), s);
    sb.duplicate = this.button("copy", t("pptxcraft.duplicate"), () => void this.cmd("edit.duplicate"), s);
    sb.remove = this.button("trash", t("pptxcraft.delete"), () => void this.cmd("edit.delete"), s);
  }

  private buildBottom(): HTMLElement {
    const bottom = el("div", "ot-px-bottom");
    this.buttons.prev = this.button("up", t("pptxcraft.previous"), () => void this.cmd("slide.previous", {}), bottom);
    this.buttons.next = this.button("down", t("pptxcraft.next"), () => void this.cmd("slide.next", {}), bottom);
    this.counter = el("span");
    bottom.appendChild(this.counter);
    bottom.appendChild(el("span", "grow"));
    this.button("zoomOut", t("pptxcraft.zoomOut"), () => this.zoomBy(1 / 1.25), bottom);
    this.button("fit", t("pptxcraft.fit"), () => this.fit(), bottom);
    this.button("zoomIn", t("pptxcraft.zoomIn"), () => this.zoomBy(1.25), bottom);
    return bottom;
  }

  private shapesMenu(): void {
    popupMenu(
      this.root,
      this.buttons.shapes,
      SHAPE_PRESETS.map(([preset, key]) => ({ label: t(`pptxcraft.${key}`), run: () => this.setTool({ shape: preset }) })),
    );
  }

  private newSlideMenu(): void {
    popupMenu(
      this.root,
      this.buttons.newSlide,
      LAYOUTS.map(([layout, key]) => ({ label: t(`pptxcraft.${key}`), run: () => void this.cmd("slide.new", { layout, at: (this.ov.slide ?? 0) + 1 }, true) })),
    );
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    const session = this.session;
    if (!session) return;
    const kind = tool === "select" ? { kind: "select" as const } : tool === "textBox" ? { kind: "textBox" as const } : { kind: "shape" as const, preset: tool.shape };
    void this.enqueue(() => session.setTool(kind));
    this.updateButtons();
  }

  private toggleNotes(): void {
    this.notesWrap.hidden = !this.notesWrap.hidden;
    void this.loadNotes();
    if (this.fitting) requestAnimationFrame(() => this.fit());
  }

  // ------------------------------------------------------------------ the engine, one call at a time

  /** Runs `fn` after everything queued before it; a failure is reported, not left hanging in the chain. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const next = this.chain.then(fn, fn).catch((e: unknown) => {
      if (!this.disposed) this.host.notifications.error(t("pptxcraft.editFailed", { message: message(e) }));
      return undefined;
    });
    this.chain = next;
    return next as Promise<T | undefined>;
  }

  /** Runs an engine command and brings the screen up to date; `slides` also redraws the slide strip. */
  private cmd(id: string, params: unknown = {}, slides = false): Promise<unknown> {
    const session = this.session;
    if (!session) return Promise.resolve();
    return this.enqueue(async () => {
      const typed = (params as { text?: unknown } | null)?.text;
      if (typeof typed === "string") await this.needFonts(typed);
      const r = await session.execute(id, params);
      if (slides) this.syncSlides(true);
      await this.refresh();
      return r;
    });
  }

  /** Reads the engine's overlay and updates the slide, selection, buttons and strip. */
  private async refresh(initial = false): Promise<void> {
    const session = this.session;
    if (!session || this.disposed) return;
    const ov = await session.overlay();
    if (this.disposed) return;
    const slideChanged = ov.slide !== this.ov.slide;
    this.ov = ov;
    if (ov.width && ov.height) {
      if (ov.width !== this.slideW || ov.height !== this.slideH) {
        this.slideW = ov.width;
        this.slideH = ov.height;
        if (this.fitting) this.fit();
      }
    }
    if (!initial && ov.dirty && ov.revision !== undefined && this.lastRevision >= 0 && ov.revision !== this.lastRevision) {
      this.thumbDirty.add(ov.slide ?? 0);
      this.pumpThumbs();
      this.onChange();
    }
    if (ov.revision !== undefined) this.lastRevision = ov.revision;
    if (ov.slides !== undefined && ov.slides !== this.thumbSlides) this.syncSlides(true);
    this.drawOverlay();
    this.updateButtons();
    this.focusInput();
    const key = `${ov.slide}:${ov.revision}:${this.zoom.toFixed(3)}`;
    if (key !== this.renderedKey) void this.renderMain(key);
    if (slideChanged) {
      this.markActiveThumb();
      void this.loadNotes();
    }
  }

  // ------------------------------------------------------------------ drawing

  private cssSize(): { w: number; h: number } {
    return { w: Math.max(1, Math.round(this.slideW * this.zoom)), h: Math.max(1, Math.round(this.slideH * this.zoom)) };
  }

  private applySize(): void {
    const { w, h } = this.cssSize();
    this.slideEl.style.width = `${w}px`;
    this.slideEl.style.height = `${h}px`;
    this.svg.setAttribute("viewBox", `0 0 ${this.slideW} ${this.slideH}`);
  }

  private async renderMain(key: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    const token = ++this.renderToken;
    const started = performance.now();
    this.applySize();
    try {
      const r = await session.render(this.ov.slide ?? 0, this.zoom * this.dpr, true);
      if (token !== this.renderToken || this.disposed) return;
      this.canvas.width = r.width;
      this.canvas.height = r.height;
      const px = new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer, r.rgba.byteOffset, r.rgba.byteLength);
      this.canvas.getContext("2d")?.putImageData(new ImageData(px, r.width, r.height), 0, 0);
      this.renderedKey = key;
      this.lastRenderMs = performance.now() - started;
    } catch (e) {
      if (!this.disposed) this.host.notifications.error(t("pptxcraft.editFailed", { message: message(e) }));
    }
  }

  private svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  }

  private drawOverlay(): void {
    const px = 1 / Math.max(this.zoom, 0.01);
    const kids: Element[] = [];
    const accent = "#2a6df4";
    const sel = this.ov.selection ?? [];
    const editing = !!this.ov.text;
    for (const s of sel) {
      const pts = s.corners.map((c) => c.join(",")).join(" ");
      kids.push(this.svgEl("polygon", { points: pts, fill: "none", stroke: accent, "stroke-width": (editing ? 1 : 1.5) * px, "stroke-dasharray": editing ? `${4 * px} ${3 * px}` : s.locked ? `${5 * px} ${3 * px}` : "none" }));
      if (!s.locked && !editing) this.drawHandles(kids, s, px, accent);
    }
    const tx = this.ov.text;
    if (tx) {
      for (const r of tx.rects) kids.push(this.svgEl("polygon", { points: r.map((c) => c.join(",")).join(" "), fill: "rgba(42,109,244,.3)" }));
      if (tx.caret) {
        const [a, b] = tx.caret;
        const c = this.svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#111", "stroke-width": 1.6 * px, class: "ot-px-caret" });
        kids.push(c);
      }
    }
    this.svg.replaceChildren(...kids);
  }

  private drawHandles(kids: Element[], s: SelectedShape, px: number, accent: string): void {
    const r = 5 * px;
    if (s.line) {
      for (const p of [s.corners[0], s.corners[2]]) kids.push(this.svgEl("circle", { cx: p[0], cy: p[1], r, fill: "#fff", stroke: accent, "stroke-width": 1.5 * px }));
      return;
    }
    const top = s.handles[1];
    kids.push(this.svgEl("line", { x1: top[0], y1: top[1], x2: s.rotate[0], y2: s.rotate[1], stroke: accent, "stroke-width": 1 * px }));
    kids.push(this.svgEl("circle", { cx: s.rotate[0], cy: s.rotate[1], r, fill: "#fff", stroke: accent, "stroke-width": 1.5 * px }));
    for (const h of s.handles) kids.push(this.svgEl("rect", { x: h[0] - r, y: h[1] - r, width: 2 * r, height: 2 * r, fill: "#fff", stroke: accent, "stroke-width": 1.5 * px }));
  }

  // ------------------------------------------------------------------ zoom

  private stageSize(): { w: number; h: number } {
    const cs = getComputedStyle(this.stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { w: this.stage.clientWidth - padX, h: this.stage.clientHeight - padY };
  }

  private fit(): void {
    this.fitting = true;
    const { w, h } = this.stageSize();
    if (w <= 0 || h <= 0) return;
    this.setZoom(Math.min(w / this.slideW, h / this.slideH), true);
  }

  private zoomBy(f: number): void {
    this.fitting = false;
    this.setZoom(this.zoom * f, false);
  }

  private setZoom(z: number, fitting: boolean): void {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (Math.abs(zoom - this.zoom) < 1e-4 && this.renderedKey) return;
    this.zoom = zoom;
    this.fitting = fitting;
    this.applySize();
    this.drawOverlay();
    if (this.ov.open) void this.renderMain(`${this.ov.slide}:${this.ov.revision}:${this.zoom.toFixed(3)}`);
  }

  // ------------------------------------------------------------------ the slide strip

  private syncSlides(all = false): void {
    const n = this.ov.slides ?? 0;
    if (all || n !== this.thumbSlides || this.thumbs.length !== n) {
      this.thumbSlides = n;
      this.side.replaceChildren();
      this.thumbs = [];
      for (let i = 0; i < n; i++) {
        const row = el("div", "ot-px-thumb");
        row.draggable = true;
        row.append(el("span", undefined, String(i + 1)));
        const frame = el("div", "frame");
        frame.appendChild(el("canvas"));
        row.appendChild(frame);
        row.addEventListener("click", () => void this.cmd("slide.go", { index: i }));
        row.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/plain", String(i)));
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          row.classList.add("drop");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drop"));
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          row.classList.remove("drop");
          const from = Number(e.dataTransfer?.getData("text/plain"));
          if (Number.isFinite(from) && from !== i) void this.cmd("slide.move", { from, to: i }, true);
        });
        this.side.appendChild(row);
        this.thumbs.push(row);
        this.thumbDirty.add(i);
      }
      this.markActiveThumb();
    }
    this.pumpThumbs();
  }

  private markActiveThumb(): void {
    const cur = this.ov.slide ?? 0;
    this.thumbs.forEach((row, i) => row.classList.toggle("on", i === cur));
    this.thumbs[cur]?.scrollIntoView({ block: "nearest" });
  }

  /** Draws the slides whose thumbnail is out of date, the current one first, one at a time so the page stays responsive. */
  private pumpThumbs(): void {
    if (this.thumbPump || this.disposed) return;
    this.thumbPump = true;
    const step = async (): Promise<void> => {
      const session = this.session;
      const cur = this.ov.slide ?? 0;
      const next = this.thumbDirty.has(cur) ? cur : [...this.thumbDirty].sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur))[0];
      if (!session || next === undefined || this.disposed) {
        this.thumbPump = false;
        return;
      }
      this.thumbDirty.delete(next);
      try {
        const canvas = this.thumbs[next]?.querySelector("canvas");
        if (canvas) {
          const r = await this.enqueue(() => session.render(next, (THUMB_W / this.slideW) * this.dpr, false));
          if (r && canvas.isConnected) {
            canvas.width = r.width;
            canvas.height = r.height;
            const px = new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer, r.rgba.byteOffset, r.rgba.byteLength);
            canvas.getContext("2d")?.putImageData(new ImageData(px, r.width, r.height), 0, 0);
          }
        }
      } catch {
        /* a thumbnail that fails stays as it was */
      }
      setTimeout(() => void step(), 30);
    };
    void step();
  }

  // ------------------------------------------------------------------ notes

  private async loadNotes(): Promise<void> {
    const session = this.session;
    if (!session || this.notesWrap.hidden) return;
    const cur = this.ov.slide ?? 0;
    if (cur === this.notesFor) return;
    this.notesFor = cur;
    const info = await this.enqueue(() => session.execute<{ notes?: string | { text?: string } }>("slide.inspect", { index: cur }));
    const n = info?.notes;
    this.notes.value = typeof n === "string" ? n : (n?.text ?? "");
  }

  private async setNotes(): Promise<void> {
    await this.cmd("slide.notes", { text: this.notes.value, index: this.ov.slide ?? 0 });
  }

  // ------------------------------------------------------------------ buttons

  private updateButtons(): void {
    const ov = this.ov;
    this.buttons.undo.disabled = !ov.canUndo;
    this.buttons.redo.disabled = !ov.canRedo;
    this.buttons.select.classList.toggle("on", this.tool === "select");
    this.buttons.text.classList.toggle("on", this.tool === "textBox");
    this.buttons.shapes.classList.toggle("on", typeof this.tool === "object");
    const n = ov.slides ?? 0;
    const cur = ov.slide ?? 0;
    this.counter.textContent = t("pptxcraft.slideOf", { n: cur + 1, total: n });
    this.buttons.prev.disabled = cur <= 0;
    this.buttons.next.disabled = cur >= n - 1;
    this.buttons.up.disabled = cur <= 0;
    this.buttons.down.disabled = cur >= n - 1;
    this.buttons.delSlide.disabled = n <= 1;
    const has = (ov.selection?.length ?? 0) > 0 || !!ov.text;
    this.sub.hidden = !has;
    const shapeOnly = !ov.text;
    for (const k of ["fill", "line", "toFront", "toBack", "duplicate", "remove"]) this.subButtons[k].hidden = !!ov.text && k !== "remove" && false;
    this.subButtons.remove.hidden = !shapeOnly;
    this.subButtons.duplicate.hidden = !shapeOnly;
  }

  // ------------------------------------------------------------------ pointer

  private wire(): void {
    const svg = this.svg;
    svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
    svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
    svg.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    this.stage.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
    this.stage.addEventListener("pointerdown", (e) => {
      if (e.target === this.stage) void this.cmd("edit.deselect");
    });
    this.root.addEventListener("keydown", (e) => this.onKey(e));
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.input.addEventListener("beforeinput", (e) => this.onBeforeInput(e));
    this.input.addEventListener("compositionend", (e) => {
      if (e.data) void this.cmd("text.insert", { text: e.data });
      this.input.value = "";
    });
    this.input.addEventListener("paste", (e) => this.onPaste(e));
    this.root.addEventListener("paste", (e) => {
      if (e.target !== this.input) this.onPaste(e);
    });
  }

  private point(e: PointerEvent): { x: number; y: number; tol: number } {
    const r = this.slideEl.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * this.slideW;
    const y = ((e.clientY - r.top) / r.height) * this.slideH;
    return { x, y, tol: (e.pointerType === "touch" ? 14 : 6) / this.zoom };
  }

  private mods(e: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): { shift: boolean; alt: boolean; cmd: boolean } {
    return { shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey || e.ctrlKey };
  }

  private onPointerDown(e: PointerEvent): void {
    const session = this.session;
    if (!session || e.button === 2 && false) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    this.focusInput();
    const p = this.point(e);
    const mods = this.mods(e);
    this.dragging = true;
    const double = e.pointerType === "touch" && e.timeStamp - this.lastTap.t < 350 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 24;
    const kind = e.button === 2 ? "contextClick" : double ? "doubleClick" : e.detail === 2 && e.pointerType !== "touch" ? "doubleClick" : e.detail >= 3 ? "tripleClick" : "down";
    void this.enqueue(async () => {
      await session.pointer({ kind, x: p.x, y: p.y, tol: p.tol, mods, pressure: e.pointerType === "pen" ? e.pressure : null });
      await this.refresh();
    });
  }

  private onPointerMove(e: PointerEvent): void {
    const session = this.session;
    if (!session) return;
    const p = this.point(e);
    if (!this.dragging) {
      if (e.pointerType === "mouse") this.hover(p);
      return;
    }
    const hadPending = this.pendingDrag !== null;
    this.pendingDrag = { x: p.x, y: p.y, mods: this.mods(e) };
    if (hadPending) return;
    void this.enqueue(async () => {
      const d = this.pendingDrag;
      this.pendingDrag = null;
      if (!d) return;
      await session.pointer({ kind: "drag", x: d.x, y: d.y, tol: p.tol, mods: d.mods });
      await this.refreshDuringDrag();
    });
  }

  /** While a shape is dragged the overlay follows it every time; the slide itself is drawn again only when that is quick. */
  private async refreshDuringDrag(): Promise<void> {
    if (this.lastRenderMs > 140) {
      const ov = await this.session?.overlay();
      if (ov) {
        this.ov = ov;
        this.drawOverlay();
      }
      return;
    }
    await this.refresh();
  }

  private onPointerUp(e: PointerEvent): void {
    const session = this.session;
    if (!session || !this.dragging) return;
    this.dragging = false;
    const p = this.point(e);
    if (e.pointerType === "touch") this.lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    void this.enqueue(async () => {
      const d = this.pendingDrag;
      this.pendingDrag = null;
      if (d) await session.pointer({ kind: "drag", x: d.x, y: d.y, tol: p.tol, mods: d.mods });
      await session.pointer({ kind: "up", x: p.x, y: p.y, tol: p.tol, mods: this.mods(e) });
      if (this.tool !== "select") {
        this.tool = "select";
        await session.setTool({ kind: "select" });
      }
      await this.refresh();
    });
  }

  private hover(p: { x: number; y: number; tol: number }): void {
    const session = this.session;
    if (!session || this.hoverBusy) return;
    this.hoverBusy = true;
    void session
      .hit(p.x, p.y, p.tol)
      .then((h) => {
        const k = h?.kind;
        this.svg.style.cursor =
          k === "resize" ? (["nwse-resize", "ns-resize", "nesw-resize", "ew-resize"][(h?.handle ?? 0) % 4] ?? "default")
          : k === "rotate" ? "grab"
          : k === "shape" ? (h?.text ? "text" : "move")
          : k === "frame" ? "move"
          : "default";
      })
      .catch(() => undefined)
      .finally(() => setTimeout(() => (this.hoverBusy = false), 60));
  }

  // ------------------------------------------------------------------ keyboard and text input

  private focusInput(): void {
    const a = document.activeElement;
    const ours = !a || a === document.body || a === this.input || a === this.root || (a.tagName === "BUTTON" && this.root.contains(a));
    if (ours) this.input.focus({ preventScroll: true });
  }

  private onBeforeInput(e: InputEvent): void {
    if (e.isComposing) return;
    const t0 = e.inputType;
    const edit = !!this.ov.text;
    if (!edit) {
      e.preventDefault();
      return;
    }
    if ((t0 === "insertText" || t0 === "insertReplacementText") && e.data) void this.cmd("text.insert", { text: e.data });
    else if (t0 === "insertLineBreak" || t0 === "insertParagraph") {
      if (performance.now() - this.enterAt < 300) return e.preventDefault();
      void this.cmd("text.insert", { text: "\n" });
    } else if (t0 === "deleteContentBackward") void this.cmd("text.delete", { dir: "backward" });
    else if (t0 === "deleteContentForward") void this.cmd("text.delete", { dir: "forward" });
    else if (t0 === "deleteWordBackward") void this.cmd("text.delete", { dir: "wordBackward" });
    else if (t0 === "deleteWordForward") void this.cmd("text.delete", { dir: "wordForward" });
    else return;
    e.preventDefault();
    this.input.value = "";
  }

  private onPaste(e: ClipboardEvent): void {
    const data = e.clipboardData;
    if (!data) return;
    const image = [...data.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = image?.getAsFile();
    if (file) {
      e.preventDefault();
      void file.arrayBuffer().then((b) => this.cmd("insert.picture", { name: file.name || "pasted.png", data: base64(new Uint8Array(b)) }));
      return;
    }
    const text = data.getData("text/plain");
    const html = data.getData("text/html");
    if (!text && !html) return;
    e.preventDefault();
    void this.cmd("edit.paste", { text: text || undefined, html: html || undefined });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.disposed || !this.session || !this.root.isConnected || e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (target && target !== this.input && ["INPUT", "SELECT"].includes(target.tagName)) return;
    if (target && target !== this.input && target.tagName === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const editing = !!this.ov.text;
    const stop = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.isComposing) return;
    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (k === "z") return stop(), void this.cmd(e.shiftKey ? "edit.redo" : "edit.undo");
      if (k === "y") return stop(), void this.cmd("edit.redo");
      if (k === "a") return stop(), void this.cmd(editing ? "text.selectAll" : "edit.selectAll");
      if (k === "b") return stop(), void this.cmd("format.bold");
      if (k === "i") return stop(), void this.cmd("format.italic");
      if (k === "u") return stop(), void this.cmd("format.underline");
      if (k === "c" || k === "x") return stop(), void this.copyOut(k === "x");
      if (k === "d" && !editing) return stop(), void this.cmd("edit.duplicate");
      if (k === "m") return stop(), void this.cmd("slide.new", { at: (this.ov.slide ?? 0) + 1 }, true);
      return;
    }
    if (editing) {
      const move = (to: string): void => {
        stop();
        void this.cmd("text.move", { to, extend: e.shiftKey });
      };
      const word = e.ctrlKey || e.altKey;
      if (key === "Escape") return stop(), void this.cmd("text.exit");
      if (key === "ArrowLeft") return move(word ? "wordLeft" : "left");
      if (key === "ArrowRight") return move(word ? "wordRight" : "right");
      if (key === "ArrowUp") return move("up");
      if (key === "ArrowDown") return move("down");
      if (key === "Home") return move(mod ? "start" : "lineStart");
      if (key === "End") return move(mod ? "end" : "lineEnd");
      if (key === "Tab") return stop(), void this.cmd(e.shiftKey ? "format.outdent" : "format.indent");
      return;
    }
    const nudge = (dx: number, dy: number): void => {
      stop();
      void this.cmd("arrange.nudge", { dx: dx * (e.shiftKey ? 6 : 1), dy: dy * (e.shiftKey ? 6 : 1) });
    };
    const selected = (this.ov.selection?.length ?? 0) > 0;
    if (key === "Delete" || key === "Backspace") return selected ? (stop(), void this.cmd("edit.delete")) : undefined;
    if (key === "Escape") return stop(), void this.cmd("edit.deselect");
    if (key === "Enter" && selected) {
      this.enterAt = performance.now();
      return stop(), void this.cmd("text.edit", { id: this.ov.selection?.[0]?.id });
    }
    if (selected && key === "ArrowLeft") return nudge(-1, 0);
    if (selected && key === "ArrowRight") return nudge(1, 0);
    if (selected && key === "ArrowUp") return nudge(0, -1);
    if (selected && key === "ArrowDown") return nudge(0, 1);
    if (key === "PageUp" || key === "ArrowLeft" || key === "ArrowUp") return stop(), void this.cmd("slide.previous", {});
    if (key === "PageDown" || key === "ArrowRight" || key === "ArrowDown") return stop(), void this.cmd("slide.next", {});
    if (key === "Home") return stop(), void this.cmd("slide.first", {});
    if (key === "End") return stop(), void this.cmd("slide.last", {});
    if (key === "F5") return stop(), void this.present();
  }

  /** Copy or cut: the engine's copy goes to the system clipboard as plain text. */
  private async copyOut(cut: boolean): Promise<void> {
    const r = (await this.cmd(cut ? "edit.cut" : "edit.copy", {})) as { text?: string } | undefined;
    if (r?.text) await navigator.clipboard?.writeText(r.text).catch(() => undefined);
  }

  // ------------------------------------------------------------------ inserting

  private async pickedPicture(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = "";
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.cmd("insert.picture", { name: file.name, data: base64(bytes) });
  }

  private async insertTable(): Promise<void> {
    const v = await formDialog(this.root, {
      title: t("pptxcraft.table"),
      ok: t("pptxcraft.ok"),
      cancel: t("pptxcraft.cancel"),
      fields: [
        { key: "rows", label: t("pptxcraft.rows"), kind: "number", value: 3 },
        { key: "cols", label: t("pptxcraft.columns"), kind: "number", value: 3 },
      ],
    });
    if (!v) return;
    const rows = Math.min(30, Math.max(1, Math.round(Number(v.rows)) || 3));
    const cols = Math.min(12, Math.max(1, Math.round(Number(v.cols)) || 3));
    await this.cmd("insert.table", { rows, cols });
  }

  private async moveSlide(by: number): Promise<void> {
    const from = this.ov.slide ?? 0;
    const to = Math.min(Math.max(0, from + by), (this.ov.slides ?? 1) - 1);
    if (to !== from) await this.cmd("slide.move", { from, to }, true);
  }

  // ------------------------------------------------------------------ presenting

  private async present(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const show = el("div", "ot-px-show");
    show.tabIndex = 0;
    const canvas = el("canvas");
    show.appendChild(canvas);
    document.body.appendChild(show);
    let index = this.ov.slide ?? 0;
    const total = this.ov.slides ?? 1;
    const draw = async (): Promise<void> => {
      const scale = Math.min(window.innerWidth / this.slideW, window.innerHeight / this.slideH) * this.dpr;
      const r = await this.enqueue(() => session.render(index, scale, false));
      if (!r || !show.isConnected) return;
      canvas.width = r.width;
      canvas.height = r.height;
      const px = new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer, r.rgba.byteOffset, r.rgba.byteLength);
      canvas.getContext("2d")?.putImageData(new ImageData(px, r.width, r.height), 0, 0);
      canvas.style.width = `${r.width / this.dpr}px`;
      canvas.style.height = `${r.height / this.dpr}px`;
    };
    const go = (by: number): void => {
      index = Math.min(total - 1, Math.max(0, index + by));
      void draw();
    };
    const end = (): void => {
      show.remove();
      document.removeEventListener("keydown", keys, true);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      void this.cmd("slide.go", { index });
    };
    const keys = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === "Escape") end();
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) go(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) go(-1);
      else if (e.key === "Home") go(-total);
      else if (e.key === "End") go(total);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", keys, true);
    show.addEventListener("pointerup", (e) => {
      const r = show.getBoundingClientRect();
      go(e.clientX < r.left + r.width / 4 ? -1 : 1);
    });
    show.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      end();
    });
    await show.requestFullscreen?.().catch(() => undefined);
    await draw();
    show.focus();
  }

  // ------------------------------------------------------------------ EditorInstance

  getText(): string {
    return "";
  }

  async getBytes(): Promise<Uint8Array> {
    await this.opened;
    const session = this.session;
    if (!session) return this.original;
    await this.chain;
    return session.save();
  }

  selection(): unknown {
    return { slide: this.ov.slide ?? 0 };
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  dispose(): void {
    this.disposed = true;
    this.endBusy();
    this.resizeObserver?.disconnect();
    this.session?.close();
    this.session = null;
    this.root?.remove();
  }
}

export const pptxCraftEditor: EditorModule = {
  create: (host) => new PptxCraftInstance(host),
};

// the engine's own error type, for the notification text of a failed open
void EngineError;
void icon;
