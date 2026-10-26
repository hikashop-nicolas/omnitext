import { EngineError, openPdf, type AnnotationInfo, type Box, type EditCall, type FieldInfo, type FindMatch, type LinkInfo, type MarkupKind, type ObjectRef, type PageObject, type PdfDocument, type TextStyle } from "craftbridge/pdf";
import PdfWorker from "craftbridge/pdf/worker?worker";
import type { CollabBinding, CollabContext, EditorInstance, HostAPI, EditorModule, EditorMountContext } from "../core/types";
import { PdfLog, type Change } from "./pdfcraft-collab";
import { openExternal } from "../core/external";
import { t } from "../i18n";
import {
  boxBetween,
  currentPage,
  fitPageZoom,
  fitZoom,
  hitBlock,
  layoutPages,
  newTextBox,
  renderScale,
  resizeBox,
  visibleRange,
  type Handle,
  type Layout,
  type PageSize,
} from "./pdfcraft-layout";

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
    .ot-pc-bar, .ot-pc-sub, .ot-pc-zoom { flex:0 0 auto; display:flex; align-items:center; gap:6px; padding:6px 8px; overflow-x:auto;
      border-bottom:1px solid var(--border); background:var(--surface); }
    .ot-pc-sub, .ot-pc-zoom { background:var(--canvas); }
    .ot-pc-bar .btn, .ot-pc-sub .btn, .ot-pc-zoom .btn, .ot-pc-float .btn { flex:0 0 auto; position:relative; }
    .ot-pc .btn.on { background:var(--accent); border-color:var(--accent); color:var(--accent-fg); }
    .ot-pc .btn:disabled { opacity:.45; cursor:default; }
    .ot-pc-bar .sep, .ot-pc-sub .sep { flex:0 0 1px; width:1px; align-self:stretch; background:var(--border); margin:0 2px; }
    .ot-pc-sub[hidden], .ot-pc-sub [hidden], .ot-pc-pill[hidden] { display:none; }
    .ot-pc-zoom input[type=range] { flex:1 1 auto; min-width:60px; accent-color:var(--accent); }
    .ot-pc-zoom input[type=number] { flex:0 0 auto; width:58px; font:inherit; padding:4px 6px; color:var(--text);
      background:var(--surface); border:1px solid var(--border); border-radius:7px; }
    .ot-pc-zoom span { color:var(--muted); font:13px system-ui, sans-serif; }
    .ot-pc-float { position:absolute; z-index:8; display:flex; flex-wrap:wrap; max-width:calc(100% - 8px); gap:4px; padding:4px; background:var(--surface); color:var(--text);
      border:1px solid var(--border); border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,.35); touch-action:none; }
    .ot-pc-float .btn { padding:6px 8px; }
    .ot-pc-float input[type=color] { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; border:0; padding:0; }
    .ot-pc-dot { position:absolute; right:3px; bottom:3px; width:9px; height:9px; border-radius:50%; border:1px solid var(--surface); }
    .ot-pc-pill { position:absolute; right:10px; bottom:10px; z-index:4; padding:3px 9px; border-radius:999px;
      background:var(--surface); color:var(--muted); border:1px solid var(--border); font:12px system-ui, sans-serif;
      pointer-events:none; opacity:.92; }
    .ot-pc-body { flex:1 1 auto; min-height:0; position:relative; display:flex; }
    .ot-pc-scroll { flex:1 1 auto; min-height:0; overflow:auto; position:relative; touch-action:pan-x pan-y; }
    .ot-pc-scroll.tool { touch-action:none; cursor:crosshair; }
    .ot-pc-content { position:relative; transform-origin:0 0; }
    .ot-pc-slot { position:absolute; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.35); }
    .ot-pc-slot canvas { display:block; width:100%; height:100%; }
    .ot-pc-sel { position:absolute; z-index:4; box-sizing:border-box; border:2px solid #2a6df4; touch-action:none; cursor:move; }
    .ot-pc-handle { position:absolute; width:16px; height:16px; margin:-8px 0 0 -8px; box-sizing:border-box; z-index:5;
      background:#fff; border:2px solid #2a6df4; border-radius:50%; touch-action:none; }
    .ot-pc-ov { position:absolute; inset:0; pointer-events:none; z-index:2; }
    .ot-pc-ov > div { position:absolute; box-sizing:border-box; }
    .ot-pc-field { background:rgba(42,109,244,.10); outline:1px solid rgba(42,109,244,.45); }
    .ot-pc-hit { background:rgba(255,213,0,.45); }
    .ot-pc-hit.cur { background:rgba(255,140,0,.55); outline:2px solid rgba(255,140,0,.9); }
    .ot-pc-tsel { background:rgba(42,109,244,.28); }
    .ot-pc-sel.ann { pointer-events:none; cursor:default; }
    .ot-pc-find { flex:0 0 auto; display:flex; align-items:center; gap:6px; padding:6px 8px; border-bottom:1px solid var(--border); background:var(--canvas); }
    .ot-pc-find[hidden] { display:none; }
    .ot-pc-find input { flex:1 1 auto; min-width:0; font:inherit; padding:5px 8px; color:var(--text); background:var(--surface);
      border:1px solid var(--border); border-radius:7px; }
    .ot-pc-find span { color:var(--muted); font:13px system-ui, sans-serif; white-space:nowrap; }
    .ot-pc-link-entry { display:flex; gap:4px; align-items:center; }
    .ot-pc-link-entry input { width:210px; max-width:60vw; font:inherit; padding:5px 8px; color:var(--text); background:var(--canvas);
      border:1px solid var(--border); border-radius:7px; }
    .ot-pc-rubber { position:absolute; z-index:4; box-sizing:border-box; border:1.5px dashed #2a6df4; background:rgba(42,109,244,.12); pointer-events:none; }
    .ot-pc-edit { position:absolute; z-index:6; box-sizing:border-box; resize:none; margin:0; padding:1px 2px;
      font-family:system-ui, sans-serif; line-height:1.15; color:#000; background:rgba(255,255,230,.97);
      border:1.5px solid #2a6df4; border-radius:2px; }
    .ot-pc-edit-bar { position:absolute; z-index:7; display:flex; gap:6px; }
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
  select: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  cover: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/><path d="M11 8v6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  fitWidth: '<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/>',
  pages: '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  blank: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>',
  delete: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  smaller: '<path d="M3.5 13h6"/><path d="m2 16 4.5-9 4.5 9"/><path d="M18 7v9"/><path d="m14 12 4 4 4-4"/>',
  larger: '<path d="M3.5 13h6"/><path d="m2 16 4.5-9 4.5 9"/><path d="M18 16V7"/><path d="m14 11 4-4 4 4"/>',
  color:
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  alignLeft: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
  alignCenter: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>',
  alignRight: '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>',
  textSelect:
    '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/><line x1="7" x2="15" y1="8" y2="8"/><line x1="7" x2="17" y1="12" y2="12"/><line x1="7" x2="13" y1="16" y2="16"/>',
  highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevUp: '<path d="m18 15-6-6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  family: '<path d="m3 15 4-8 4 8"/><path d="M4 13h6"/><circle cx="18" cy="12" r="3"/><path d="M21 9v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
} as const;

type IconName = keyof typeof ICONS;

function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const hex = (c: [number, number, number]): string => "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Tool = "select" | "text" | "cover" | "textsel";

interface Slot {
  box: HTMLElement;
  canvas: HTMLCanvasElement | null;
  /** Zoom and edit generation the canvas was drawn at; `tile` is the part of the page it covers (CSS px), when only a part was drawn. */
  drawn: { zoom: number; gen: number; tile?: Box } | null;
}

interface Selection {
  page: number;
  obj: PageObject;
  /** Set when the selection is a mark or comment, which can only be deleted. */
  ann?: AnnotationInfo;
}

interface Extras {
  annotations: AnnotationInfo[];
  links: LinkInfo[];
  fields: FieldInfo[];
}

interface TextSel {
  page: number;
  text: string;
  rects: Box[];
}

const FAMILIES = ["helvetica", "times", "courier"] as const;

/** The box around a list of boxes. */
const bounds = (rects: Box[]): Box => [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];

/** Ligature code points (fi, fl...) back to plain letters: the engine's fallback face has no glyph for them. */
const plainLetters = (s: string): string => s.replace(/[\uFB00-\uFB06]/g, (c) => c.normalize("NFKC"));

class PdfCraftInstance implements EditorInstance {
  constructor(private readonly host: HostAPI) {}
  private root!: HTMLElement;
  private bar!: HTMLElement;
  private sub!: HTMLElement;
  private scroller!: HTMLElement;
  private content!: HTMLElement;
  private pill!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private doc: PdfDocument | null = null;
  private original: Uint8Array = new Uint8Array();
  private onChange: (() => void) | undefined;
  private sizes: PageSize[] = [];
  private layout: Layout = { tops: [], widths: [], heights: [], total: 0 };
  private slots: Slot[] = [];
  private zoom = 1;
  private fitKind: "page" | "width" | null = null;
  private gen = 0;
  private edited = false;
  private disposed = false;
  private rendering = false;
  private raf = 0;
  private objectCache = new Map<number, PageObject[]>();
  private tool: Tool = "select";
  private sel: Selection | null = null;
  private selEl: HTMLElement | null = null;
  private pagesOpen = false;
  private editing: { page: number; obj: PageObject | null; box: Box; area: HTMLTextAreaElement; bar: HTMLElement; field?: { value: string; save: (text: string) => Promise<void> } } | null = null;
  private buttons: Record<string, HTMLButtonElement> = {};
  private subButtons: Record<string, HTMLButtonElement> = {};
  private zoomRow!: HTMLElement;
  private zoomRange!: HTMLInputElement;
  private zoomNum!: HTMLInputElement;
  private floatEl: HTMLElement | null = null;
  private password: string | undefined;
  /** Set while this peer is in a sharing session: every edit goes through the shared log. */
  private shared: PdfLog | null = null;
  private viewOnly = false;
  private localEdits = 0;
  /** The file every peer started the session from, and the bytes offered for it before the session binds. */
  private sessionBase: Uint8Array | null = null;
  private pendingBase: Uint8Array | null = null;
  private extraCache = new Map<number, Extras>();
  private textSel: TextSel | null = null;
  private selDrag: { page: number; from: [number, number]; busy: boolean; pending: [number, number] | null } | null = null;
  private findRow!: HTMLElement;
  private findInput!: HTMLInputElement;
  private findCount!: HTMLElement;
  private matches: FindMatch[] = [];
  private matchIndex = -1;
  private findTimer = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number; cx: number; cy: number } | null = null;
  private tap: { x: number; y: number; time: number; moved: boolean } | null = null;
  private rubber: { page: number; from: [number, number]; el: HTMLElement } | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.onChange = ctx.onChange;
    this.original = ctx.bytes ?? new Uint8Array();
    this.root = el("div", "ot-pc");
    this.bar = el("div", "ot-pc-bar");
    this.zoomRow = el("div", "ot-pc-zoom");
    this.sub = el("div", "ot-pc-sub");
    this.sub.hidden = true;
    this.findRow = el("div", "ot-pc-find");
    this.findRow.hidden = true;
    this.scroller = el("div", "ot-pc-scroll");
    this.content = el("div", "ot-pc-content");
    this.scroller.appendChild(this.content);
    this.pill = el("div", "ot-pc-pill");
    this.pill.hidden = true;
    const body = el("div", "ot-pc-body");
    body.append(this.scroller, this.pill);
    this.fileInput = el("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => void this.pickedImage());
    this.root.append(this.bar, this.zoomRow, this.findRow, this.sub, body, this.fileInput);
    container.appendChild(this.root);
    this.buildBar();
    this.buildZoom();
    this.buildFind();
    this.buildSub();
    this.scroller.addEventListener("scroll", () => this.scheduleRender(), { passive: true });
    this.scroller.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.scroller.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.scroller.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.scroller.addEventListener("pointercancel", (e) => this.onPointerEnd(e));
    this.scroller.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    window.addEventListener("resize", this.onResize);
    void this.open();
  }

  private lastWidth = 0;

  // the on-screen keyboard only changes the height: leave the layout and any open edit alone
  private onResize = (): void => {
    const width = this.scroller.clientWidth;
    const same = width === this.lastWidth;
    this.lastWidth = width;
    if (same || this.editing) return;
    if (!this.fitKind) {
      this.applyLayout();
      return;
    }
    this.fit(this.fitKind);
  };

  // ------------------------------------------------------------------ toolbars

  private button(into: HTMLElement, store: Record<string, HTMLButtonElement>, key: string, glyph: IconName, label: string, onClick: () => void, className?: string): HTMLButtonElement {
    const b = el("button", `btn icon${className ? " " + className : ""}`);
    b.type = "button";
    b.innerHTML = icon(glyph);
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    store[key] = b;
    into.appendChild(b);
    return b;
  }

  private buildBar(): void {
    const sep = () => this.bar.appendChild(el("span", "sep"));
    const b = (key: string, glyph: IconName, label: string, onClick: () => void, cls?: string) => this.button(this.bar, this.buttons, key, glyph, label, onClick, cls);
    b("undo", "undo", t("pdfcraft.undo"), () => void this.history("undo"));
    b("redo", "redo", t("pdfcraft.redo"), () => void this.history("redo"));
    sep();
    b("select", "select", t("pdfcraft.select"), () => this.setTool("select"));
    b("text", "text", t("pdfcraft.addText"), () => this.setTool("text"));
    b("image", "image", t("pdfcraft.addImage"), () => this.fileInput.click());
    b("cover", "cover", t("pdfcraft.cover"), () => this.setTool("cover"));
    b("textsel", "textSelect", t("pdfcraft.selectText"), () => this.setTool("textsel"));
    sep();
    b("pages", "pages", t("pdfcraft.pages"), () => this.togglePages());
    for (const x of Object.values(this.buttons)) x.disabled = true;
    this.buttons.select!.classList.add("on");
  }

  /** Fit button, zoom slider and the percentage, as the other editors have them. */
  private buildZoom(): void {
    this.button(this.zoomRow, this.buttons, "fit", "fit", t("pdfcraft.fitPage"), () => this.fit(this.fitKind === "page" ? "width" : "page")).disabled = true;
    this.zoomRange = el("input");
    this.zoomRange.type = "range";
    this.zoomRange.min = String(MIN_ZOOM * 100);
    this.zoomRange.max = String(MAX_ZOOM * 100);
    this.zoomRange.step = "5";
    this.zoomRange.value = "100";
    this.zoomRange.title = t("pdfcraft.zoomLevel");
    this.zoomRange.setAttribute("aria-label", t("pdfcraft.zoomLevel"));
    this.zoomNum = el("input");
    this.zoomNum.type = "number";
    this.zoomNum.min = String(MIN_ZOOM * 100);
    this.zoomNum.max = String(MAX_ZOOM * 100);
    this.zoomNum.value = "100";
    this.zoomNum.setAttribute("aria-label", t("pdfcraft.zoomPercent"));
    const pct = el("span", undefined, "%");
    this.zoomRange.addEventListener("input", () => this.userZoom(Number(this.zoomRange.value)));
    this.zoomNum.addEventListener("change", () => this.userZoom(Number(this.zoomNum.value)));
    this.zoomRow.append(this.zoomRange, this.zoomNum, pct);
    this.button(this.zoomRow, this.buttons, "find", "search", t("pdfcraft.find"), () => this.toggleFind()).disabled = true;
  }

  private userZoom(percent: number): void {
    if (!Number.isFinite(percent)) return;
    this.fitKind = null;
    this.setZoom(percent / 100, true);
  }

  private buildFind(): void {
    this.findInput = el("input");
    this.findInput.type = "search";
    this.findInput.placeholder = t("pdfcraft.find");
    this.findInput.setAttribute("aria-label", t("pdfcraft.find"));
    this.findInput.addEventListener("input", () => {
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => void this.runFind(), 250);
    });
    this.findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.stepFind(e.shiftKey ? -1 : 1);
      }
    });
    this.findCount = el("span");
    const mk = (glyph: IconName, label: string, cb: () => void) => {
      const b = el("button", "btn icon");
      b.type = "button";
      b.innerHTML = icon(glyph);
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", cb);
      return b;
    };
    this.findRow.append(
      this.findInput,
      this.findCount,
      mk("chevUp", t("pdfcraft.findPrevious"), () => this.stepFind(-1)),
      mk("chevDown", t("pdfcraft.findNext"), () => this.stepFind(1)),
      mk("close", t("pdfcraft.cancel"), () => this.toggleFind(false)),
    );
  }

  private toggleFind(open: boolean = !!this.findRow.hidden): void {
    this.findRow.hidden = !open;
    this.buttons.find?.classList.toggle("on", open);
    if (open) {
      this.findInput.focus();
      this.findInput.select();
    } else {
      this.matches = [];
      this.matchIndex = -1;
      this.findCount.textContent = "";
      this.paintAll();
    }
  }

  private async runFind(): Promise<void> {
    const query = this.findInput.value.trim();
    if (!this.doc) return;
    try {
      this.matches = query ? await this.doc.find(query, { limit: 500 }) : [];
    } catch (e) {
      this.fail(e);
      return;
    }
    this.matchIndex = this.matches.length ? 0 : -1;
    this.updateFindCount();
    this.paintAll();
    this.revealMatch();
  }

  private stepFind(dir: 1 | -1): void {
    if (!this.matches.length) return;
    this.matchIndex = (this.matchIndex + dir + this.matches.length) % this.matches.length;
    this.updateFindCount();
    this.paintAll();
    this.revealMatch();
  }

  private updateFindCount(): void {
    const n = this.matches.length;
    this.findCount.textContent = this.findInput.value.trim() ? (n ? `${this.matchIndex + 1} / ${n}` : t("pdfcraft.noMatches")) : "";
  }

  /** Scrolls the current match to about a third of the way down the view. */
  private revealMatch(): void {
    const m = this.matches[this.matchIndex];
    const r = m?.rects[0];
    if (!m || !r) return;
    const top = (this.layout.tops[m.page] ?? 0) + r[1] * this.zoom;
    this.scroller.scrollTop = Math.max(0, top - this.scroller.clientHeight / 3);
    const left = (this.slots[m.page]?.box.offsetLeft ?? 0) + r[0] * this.zoom;
    if (left < this.scroller.scrollLeft || left > this.scroller.scrollLeft + this.scroller.clientWidth - 40) this.scroller.scrollLeft = Math.max(0, left - 40);
  }

  // ------------------------------------------------------------------ overlays

  private async extras(page: number): Promise<Extras> {
    const cached = this.extraCache.get(page);
    if (cached) return cached;
    const doc = this.doc;
    const out: Extras = doc ? { annotations: await doc.annotations(page), links: await doc.links(page), fields: await doc.fields(page) } : { annotations: [], links: [], fields: [] };
    this.extraCache.set(page, out);
    return out;
  }

  /** Form fields, search matches and the text selection, drawn over a page. */
  private paintOverlays(page: number): void {
    const slot = this.slots[page];
    if (!slot) return;
    slot.box.querySelector(":scope > .ot-pc-ov")?.remove();
    const ov = el("div", "ot-pc-ov");
    const z = this.zoom;
    const rect = (b: Box, cls: string) => {
      const d = el("div", cls);
      d.style.cssText = `left:${b[0] * z}px;top:${b[1] * z}px;width:${(b[2] - b[0]) * z}px;height:${(b[3] - b[1]) * z}px`;
      ov.appendChild(d);
    };
    for (const f of this.extraCache.get(page)?.fields ?? []) if (f.kind !== "button" && f.kind !== "signature") rect(f.view, "ot-pc-field");
    this.matches.forEach((m, i) => {
      if (m.page === page) for (const r of m.rects) rect(r, i === this.matchIndex ? "ot-pc-hit cur" : "ot-pc-hit");
    });
    if (this.textSel?.page === page) for (const r of this.textSel.rects) rect(r, "ot-pc-tsel");
    slot.box.appendChild(ov);
  }

  private paintAll(): void {
    for (let i = 0; i < this.slots.length; i++) this.paintOverlays(i);
  }

  /** Page operations: they act on the page in view, so they live in a panel of their own. */
  private buildSub(): void {
    const b = (key: string, glyph: IconName, label: string, onClick: () => void) => this.button(this.sub, this.subButtons, key, glyph, label, onClick);
    b("rotate", "rotate", t("pdfcraft.rotate"), () => void this.pageOp("rotate"));
    b("up", "up", t("pdfcraft.moveUp"), () => void this.pageOp("up"));
    b("down", "down", t("pdfcraft.moveDown"), () => void this.pageOp("down"));
    b("blank", "blank", t("pdfcraft.addBlank"), () => void this.pageOp("blank"));
    b("deletePage", "delete", t("pdfcraft.deletePage"), () => void this.pageOp("delete"));
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.cancelEdit();
    for (const [k, b] of Object.entries(this.buttons)) if (k === "select" || k === "text" || k === "cover" || k === "textsel") b.classList.toggle("on", k === tool);
    this.scroller.classList.toggle("tool", tool === "cover" || tool === "textsel");
    if (tool !== "select") this.select(null);
    if (tool !== "textsel") this.clearTextSelection();
  }

  private togglePages(): void {
    this.pagesOpen = !this.pagesOpen;
    this.buttons.pages!.classList.toggle("on", this.pagesOpen);
    this.sub.hidden = !this.pagesOpen;
  }

  private async refreshHistory(): Promise<void> {
    if (!this.doc) return;
    if (this.shared) {
      this.buttons.undo!.disabled = this.viewOnly || !this.shared.canUndo();
      this.buttons.redo!.disabled = this.viewOnly || !this.shared.canRedo();
      return;
    }
    const h = await this.doc.history();
    this.buttons.undo!.disabled = !h.undo;
    this.buttons.redo!.disabled = !h.redo;
  }

  /** Every change to the document goes through here: straight to the engine, or through the shared log in a session. */
  private async commit(call: EditCall): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    if (this.viewOnly) throw new Error("this session is view-only");
    if (!this.shared) {
      await doc.execute(call);
      return;
    }
    this.localEdits++;
    try {
      await this.shared.perform(call);
    } finally {
      this.localEdits--;
    }
  }

  // ------------------------------------------------------------------ opening

  private showMessage(content: HTMLElement | string): void {
    this.content.replaceChildren();
    this.content.style.height = "";
    const box = el("div", "ot-pc-msg");
    if (typeof content === "string") box.textContent = content;
    else box.appendChild(content);
    this.content.appendChild(box);
  }

  private fail(e: unknown): void {
    this.showMessage(t("pdfcraft.failed", { message: message(e) }));
  }

  private async open(password?: string, wrong = false): Promise<void> {
    try {
      this.doc = await openPdf(this.original, { password, worker: new PdfWorker() });
      this.password = password;
    } catch (e) {
      if (this.disposed) return;
      if (e instanceof EngineError && (e.code === "needs-password" || e.code === "wrong-password")) this.askPassword(wrong || e.code === "wrong-password");
      else this.fail(e);
      return;
    }
    if (this.disposed) {
      this.doc.close();
      return;
    }
    await this.loadPages();
    this.fit("page");
    for (const x of Object.values(this.buttons)) x.disabled = false;
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
    this.showMessage(form);
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
    this.objectCache.clear();
    this.extraCache.clear();
    this.matches = [];
    this.matchIndex = -1;
    this.updateFindCount();
    this.buildSlots();
  }

  // ------------------------------------------------------------------ layout and drawing

  private buildSlots(): void {
    this.cancelEdit();
    this.selEl = null;
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
    // Pages sit in the middle of a content box at least as wide as the view, so a page wider than
    // the view scrolls from its left edge instead of being cut off.
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
    this.renderSelection();
    this.paintAll();
    this.scheduleRender();
  }

  private updatePageLabel(): void {
    if (!this.sizes.length) return;
    const n = currentPage(this.layout, this.scroller.scrollTop, this.scroller.clientHeight) + 1;
    this.pill.hidden = false;
    this.pill.textContent = `${n} / ${this.sizes.length}`;
    this.pill.setAttribute("aria-label", t("pdfcraft.page", { n, total: this.sizes.length }));
  }

  /** Fits the whole page, or only its width, to the view, and remembers which until the person zooms. */
  private fit(kind: "page" | "width"): void {
    this.fitKind = kind;
    const w = this.scroller.clientWidth || 360;
    const h = this.scroller.clientHeight || 640;
    const page = this.sizes[kind === "page" ? this.currentIndex() : 0] ?? this.sizes[0] ?? { w: 612, h: 792 };
    this.setZoom(kind === "page" ? fitPageZoom(w, h, page) : fitZoom(w, this.sizes), false);
    if (kind === "page") this.scroller.scrollTop = Math.max(0, (this.layout.tops[this.currentIndex()] ?? GAP) - GAP);
    const b = this.buttons.fit;
    if (b) {
      const next = kind === "page" ? "fitWidth" : "fit";
      b.innerHTML = icon(next);
      b.title = t(kind === "page" ? "pdfcraft.fit" : "pdfcraft.fitPage");
      b.setAttribute("aria-label", b.title);
    }
  }

  private setZoom(next: number, keepCenter: boolean, anchor?: { cx: number; cy: number }): void {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (zoom === this.zoom && this.layout.tops.length) {
      this.applyLayout();
      return;
    }
    const before = this.zoom;
    // The document point under the anchor (default: the middle of the view) stays under it.
    const cx = anchor?.cx ?? this.scroller.clientWidth / 2;
    const cy = anchor?.cy ?? this.scroller.clientHeight / 2;
    const docY = (this.scroller.scrollTop + cy) / before;
    const docX = (this.scroller.scrollLeft + cx) / before;
    this.zoom = zoom;
    for (const slot of this.slots) {
      if (slot.drawn?.tile) {
        slot.canvas?.remove();
        slot.canvas = null;
        slot.drawn = null;
      }
    }
    this.zoomRange.value = String(Math.round(zoom * 100));
    this.zoomNum.value = String(Math.round(zoom * 100));
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
          if (!d || d.zoom !== this.zoom || d.gen !== this.gen) return true;
          if (!d.tile) return false;
          const need = this.visibleRegion(i, 0);
          return need[0] < d.tile[0] - 1 || need[1] < d.tile[1] - 1 || need[2] > d.tile[2] + 1 || need[3] > d.tile[3] + 1;
        };
        let target = -1;
        for (let i = range[0]; i <= range[1]; i++) {
          if (stale(i)) {
            target = i;
            break;
          }
        }
        if (target < 0) return;
        if (!(await this.draw(target))) return;
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

  /** The part of a page in view (CSS px from its top-left), widened by `margin` times the view's size. */
  private visibleRegion(page: number, margin: number): Box {
    const slot = this.slots[page]!.box;
    const w = this.layout.widths[page] ?? 0;
    const h = this.layout.heights[page] ?? 0;
    const mx = this.scroller.clientWidth * margin;
    const my = this.scroller.clientHeight * margin;
    const x0 = this.scroller.scrollLeft - slot.offsetLeft - mx;
    const y0 = this.scroller.scrollTop - (this.layout.tops[page] ?? 0) - my;
    const x1 = x0 + this.scroller.clientWidth + 2 * mx;
    const y1 = y0 + this.scroller.clientHeight + 2 * my;
    return [Math.max(0, x0), Math.max(0, y0), Math.min(w, x1), Math.min(h, y1)];
  }

  private async draw(page: number): Promise<boolean> {
    const doc = this.doc;
    const slot = this.slots[page];
    const size = this.sizes[page];
    if (!doc || !slot || !size) return false;
    const zoom = this.zoom;
    const gen = this.gen;
    try {
      const dpr = window.devicePixelRatio || 1;
      const wanted = Math.min(400, Math.max(0.1, zoom * dpr));
      // A page drawn whole is capped by a pixel budget; past that, draw only the part in view, sharp.
      const tiled = renderScale(zoom, dpr, size) < wanted - 1e-6;
      let tile: [number, number, number, number] | undefined;
      let area: Box | undefined;
      if (tiled) {
        area = this.visibleRegion(page, 0.5);
        const x = Math.floor(area[0] * dpr);
        const y = Math.floor(area[1] * dpr);
        const w = Math.max(1, Math.min(4096, Math.ceil((area[2] - area[0]) * dpr), Math.floor(size.w * wanted) - x));
        const h = Math.max(1, Math.min(4096, Math.ceil((area[3] - area[1]) * dpr), Math.floor(size.h * wanted) - y));
        tile = [x, y, w, h];
      }
      const r = await doc.render(page, tiled ? wanted : renderScale(zoom, dpr, size), tile);
      if (this.disposed || zoom !== this.zoom || gen !== this.gen || this.slots[page] !== slot) return true;
      const canvas = el("canvas");
      canvas.width = r.width;
      canvas.height = r.height;
      const c2d = canvas.getContext("2d");
      if (!c2d) return false;
      c2d.putImageData(new ImageData(new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer), r.width, r.height), 0, 0);
      let covered: Box | undefined;
      if (tile) {
        const [x, y] = tile;
        canvas.style.cssText = `position:absolute;left:${x / dpr}px;top:${y / dpr}px;width:${r.width / dpr}px;height:${r.height / dpr}px`;
        covered = [x / dpr, y / dpr, (x + r.width) / dpr, (y + r.height) / dpr];
      }
      slot.canvas?.remove();
      slot.box.prepend(canvas);
      slot.canvas = canvas;
      slot.drawn = { zoom, gen, ...(covered ? { tile: covered } : {}) };
      this.paintOverlays(page);
      void this.extras(page).then(() => this.paintOverlays(page));
      return true;
    } catch (e) {
      if (!this.disposed) console.warn("pdfcraft: page", page + 1, "did not draw", e);
      // Do not retry this page until something changes, or a bad page would spin forever.
      slot.drawn = { zoom, gen };
      return true;
    }
  }

  // ------------------------------------------------------------------ pointer input

  private onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.fitKind = null;
    const rect = this.scroller.getBoundingClientRect();
    this.setZoom(this.zoom * Math.exp(-e.deltaY / 200), true, { cx: e.clientX - rect.left, cy: e.clientY - rect.top });
  }

  private pageAt(clientX: number, clientY: number): { page: number; x: number; y: number } | null {
    for (let i = 0; i < this.slots.length; i++) {
      const r = this.slots[i]!.box.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return { page: i, x: (clientX - r.left) / this.zoom, y: (clientY - r.top) / this.zoom };
      }
    }
    return null;
  }

  private onPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest(".ot-pc-sel, .ot-pc-edit, .ot-pc-edit-bar, .ot-pc-float")) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.tap = { x: e.clientX, y: e.clientY, time: Date.now(), moved: false };
    else this.tap = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const rect = this.scroller.getBoundingClientRect();
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom, cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top };
      this.scroller.style.touchAction = "none";
      this.cancelRubber();
    } else if (this.tool === "cover" && this.pointers.size === 1) {
      const at = this.pageAt(e.clientX, e.clientY);
      if (at) this.startRubber(at.page, [at.x, at.y]);
    } else if (this.tool === "textsel" && this.pointers.size === 1) {
      const at = this.pageAt(e.clientX, e.clientY);
      this.clearTextSelection();
      if (at) this.selDrag = { page: at.page, from: [at.x, at.y], busy: false, pending: null };
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 8) this.tap.moved = true;
    if (this.rubber) {
      const r = this.slots[this.rubber.page]!.box.getBoundingClientRect();
      this.drawRubber([(e.clientX - r.left) / this.zoom, (e.clientY - r.top) / this.zoom]);
    }
    if (this.selDrag) {
      const r = this.slots[this.selDrag.page]!.box.getBoundingClientRect();
      void this.updateSelection([(e.clientX - r.left) / this.zoom, (e.clientY - r.top) / this.zoom]);
    }
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
    const rubber = this.rubber;
    const wasPinch = !!this.pinch;
    if (rubber) {
      const r = this.slots[rubber.page]!.box.getBoundingClientRect();
      void this.finishRubber([(e.clientX - r.left) / this.zoom, (e.clientY - r.top) / this.zoom]);
    }
    const drag = this.selDrag;
    if (drag) {
      const r = this.slots[drag.page]!.box.getBoundingClientRect();
      this.selDrag = null;
      void this.finishSelection(drag, [(e.clientX - r.left) / this.zoom, (e.clientY - r.top) / this.zoom]);
    }
    this.onPointerEnd(e);
    if (tap && !tap.moved && !rubber && !drag && !wasPinch) {
      const held = Date.now() - tap.time;
      if (held < 500) void this.onTap(e.clientX, e.clientY);
      else void this.onLongPress(e.clientX, e.clientY);
    }
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
      this.fitKind = null;
      this.setZoom(pinch.zoom * ratio, true, { cx: pinch.cx, cy: pinch.cy });
    }
  }

  // ------------------------------------------------------------------ objects, selection

  private async objects(page: number): Promise<PageObject[]> {
    const cached = this.objectCache.get(page);
    if (cached) return cached;
    const list = this.doc ? await this.doc.objects(page) : [];
    this.objectCache.set(page, list);
    return list;
  }

  private async onTap(clientX: number, clientY: number): Promise<void> {
    if (!this.doc || this.editing) return;
    const at = this.pageAt(clientX, clientY);
    if (!at) {
      this.select(null);
      return;
    }
    if (this.tool === "text") {
      this.startEdit(at.page, null, newTextBox(at.x, at.y, this.sizes[at.page]!));
      return;
    }
    if (this.tool === "textsel") {
      this.clearTextSelection();
      return;
    }
    if (this.tool !== "select") return;
    const objects = await this.objects(at.page);
    const extras = await this.extras(at.page);
    // the smallest thing under the finger wins; a mark beats the text it sits on when they are the same size
    const candidates: { view: Box; obj?: PageObject; ann?: AnnotationInfo }[] = [...extras.annotations.map((ann) => ({ view: ann.view, ann })), ...objects.map((obj) => ({ view: obj.view, obj }))];
    const hit = hitBlock(candidates.map((c) => c.view), at.x, at.y);
    if (hit >= 0) {
      const c = candidates[hit]!;
      if (c.obj) this.select({ page: at.page, obj: c.obj });
      else if (c.ann) this.select({ page: at.page, ann: c.ann, obj: { kind: "added", index: -1, type: "image", text: null, view: c.ann.view, style: null } });
      return;
    }
    const field = hitBlock(extras.fields.map((f) => f.view), at.x, at.y);
    if (field >= 0) {
      this.select(null);
      void this.useField(at.page, extras.fields[field]!);
      return;
    }
    this.select(null);
    const link = hitBlock(extras.links.map((l) => l.view), at.x, at.y);
    if (link >= 0) this.followLink(extras.links[link]!);
  }

  /** A long press follows a link even where text sits under it, which a tap would select for editing. */
  private async onLongPress(clientX: number, clientY: number): Promise<void> {
    if (!this.doc || this.tool !== "select") return;
    const at = this.pageAt(clientX, clientY);
    if (!at) return;
    const extras = await this.extras(at.page);
    const link = hitBlock(extras.links.map((l) => l.view), at.x, at.y);
    if (link >= 0) this.followLink(extras.links[link]!);
  }

  private followLink(link: LinkInfo): void {
    if (link.page !== undefined && this.layout.tops[link.page] !== undefined) {
      this.scroller.scrollTop = Math.max(0, this.layout.tops[link.page]! - GAP);
      return;
    }
    // only web and mail addresses leave the document; a script or file address in a PDF does not
    if (link.uri) openExternal(link.uri);
  }

  /** Fills a form field: a check box toggles, text and choices open a box to type in. */
  private async useField(page: number, field: FieldInfo): Promise<void> {
    if (!this.doc) return;
    if (field.kind === "check") {
      const on = !!field.value && field.value.toLowerCase() !== "off";
      await this.run(page, () => this.commit({ op: "setField", name: field.name, value: { check: !on } }));
      return;
    }
    if (field.kind === "text" || field.kind === "choice") {
      this.startEdit(page, null, field.view, { value: field.value ?? "", save: (text) => this.commit({ op: "setField", name: field.name, value: field.kind === "choice" ? { choice: [text] } : { text } }) });
    }
  }

  // ------------------------------------------------------------------ selecting text and marking it up

  private clearTextSelection(): void {
    const had = this.textSel?.page;
    this.textSel = null;
    this.selDrag = null;
    this.floatEl?.remove();
    this.floatEl = null;
    if (had !== undefined) this.paintOverlays(had);
  }

  private async updateSelection(to: [number, number]): Promise<void> {
    const drag = this.selDrag;
    if (!drag || !this.doc) return;
    if (drag.busy) {
      drag.pending = to;
      return;
    }
    drag.busy = true;
    try {
      const res = await this.doc.selectText(drag.page, drag.from, to);
      this.textSel = { page: drag.page, text: res.text, rects: res.rects };
      this.paintOverlays(drag.page);
    } catch {
      // a point outside the text: keep what was selected
    }
    drag.busy = false;
    const next = drag.pending;
    drag.pending = null;
    if (next && this.selDrag === drag) void this.updateSelection(next);
  }

  private async finishSelection(drag: { page: number; from: [number, number] }, to: [number, number]): Promise<void> {
    if (!this.doc) return;
    try {
      const res = await this.doc.selectText(drag.page, drag.from, to);
      this.textSel = res.text.trim() ? { page: drag.page, text: res.text, rects: res.rects } : null;
    } catch {
      this.textSel = null;
    }
    this.paintOverlays(drag.page);
    this.renderTextFloat();
  }

  /** The tools for the selected text: mark it up, copy it, or link it. */
  private renderTextFloat(): void {
    this.floatEl?.remove();
    this.floatEl = null;
    const sel = this.textSel;
    const slot = sel && this.slots[sel.page];
    if (!sel || !slot || !sel.rects.length) return;
    const bar = el("div", "ot-pc-float");
    const add = (glyph: IconName, label: string, cb: () => void) => {
      const b = el("button", "btn icon");
      b.type = "button";
      b.innerHTML = icon(glyph);
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", cb);
      bar.appendChild(b);
    };
    const mark = (kind: MarkupKind) => () => void this.markSelection(kind);
    add("highlight", t("pdfcraft.highlight"), mark("highlight"));
    add("underline", t("pdfcraft.underline"), mark("underline"));
    add("strike", t("pdfcraft.strikeout"), mark("strikeout"));
    add("copy", t("pdfcraft.copy"), () => void navigator.clipboard?.writeText(sel.text).catch(() => {}));
    add("link", t("pdfcraft.addLink"), () => this.askLink(bar));
    add("close", t("pdfcraft.cancel"), () => this.clearTextSelection());
    slot.box.appendChild(bar);
    this.floatEl = bar;
    this.placeFloat(bar, sel.page, bounds(sel.rects));
  }

  private async markSelection(kind: MarkupKind): Promise<void> {
    const sel = this.textSel;
    if (!sel || !this.doc) return;
    this.clearTextSelection();
    await this.run(sel.page, () => this.commit({ op: "markup", page: sel.page, kind, rects: sel.rects }));
  }

  /** Swaps the selection's tools for a box to type the link's address in. */
  private askLink(bar: HTMLElement): void {
    const sel = this.textSel;
    if (!sel) return;
    bar.replaceChildren();
    const row = el("form", "ot-pc-link-entry");
    const input = el("input");
    input.type = "text";
    input.placeholder = "https://";
    input.setAttribute("aria-label", t("pdfcraft.addLink"));
    const ok = el("button", "btn icon");
    ok.type = "submit";
    ok.innerHTML = icon("check");
    ok.title = ok.ariaLabel = t("pdfcraft.done");
    const no = el("button", "btn icon");
    no.type = "button";
    no.innerHTML = icon("close");
    no.title = no.ariaLabel = t("pdfcraft.cancel");
    no.addEventListener("click", () => this.renderTextFloat());
    row.addEventListener("submit", (e) => {
      e.preventDefault();
      const target = input.value.trim();
      if (target) void this.linkSelection(target);
    });
    row.append(input, ok, no);
    bar.appendChild(row);
    this.placeFloat(bar, sel.page, bounds(sel.rects));
    input.focus();
  }

  private async linkSelection(target: string): Promise<void> {
    const sel = this.textSel;
    if (!sel || !this.doc) return;
    this.clearTextSelection();
    await this.run(sel.page, () => this.commit({ op: "addLink", page: sel.page, view: bounds(sel.rects), target }));
  }

  private select(sel: Selection | null): void {
    this.sel = sel;
    this.renderSelection();
  }

  /** Draws the box and handles of the selected object over its page. */
  private renderSelection(): void {
    this.selEl?.remove();
    this.selEl = null;
    this.floatEl?.remove();
    this.floatEl = null;
    const sel = this.sel;
    const slot = sel && this.slots[sel.page];
    if (!sel || !slot) return;
    const z = this.zoom;
    const [x0, y0, x1, y1] = sel.obj.view;
    const box = el("div", sel.ann ? "ot-pc-sel ann" : "ot-pc-sel");
    box.style.cssText += `left:${x0 * z}px;top:${y0 * z}px;width:${(x1 - x0) * z}px;height:${(y1 - y0) * z}px`;
    if (sel.ann) {
      slot.box.appendChild(box);
      this.selEl = box;
      this.buildFloat(sel, slot.box);
      return;
    }
    const isText = sel.obj.type === "text";
    // existing text only rewraps to a new width; everything else resizes from its corners
    const handles: [Handle, string][] = sel.obj.kind === "text" ? [["e", "100% 50%"]] : [["nw", "0 0"], ["ne", "100% 0"], ["sw", "0 100%"], ["se", "100% 100%"]];
    for (const [handle, pos] of handles) {
      const h = el("div", "ot-pc-handle");
      const [px, py] = pos.split(" ") as [string, string];
      h.style.left = px;
      h.style.top = py;
      h.addEventListener("pointerdown", (ev) => this.dragHandle(ev, handle, sel, box));
      box.appendChild(h);
    }
    box.addEventListener("pointerdown", (ev) => {
      if ((ev.target as HTMLElement).classList.contains("ot-pc-handle")) return;
      this.dragMove(ev, sel, box, isText);
    });
    slot.box.appendChild(box);
    this.selEl = box;
    this.buildFloat(sel, slot.box);
  }

  /** The tools for the selected object, floating next to it so the top bar stays short. */
  private buildFloat(sel: Selection, slot: HTMLElement): void {
    const bar = el("div", "ot-pc-float");
    const style = sel.obj.style;
    const add = (glyph: IconName, label: string, onClick: () => void, on = false): HTMLButtonElement => {
      const b = el("button", `btn icon${on ? " on" : ""}`);
      b.type = "button";
      b.innerHTML = icon(glyph);
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
      bar.appendChild(b);
      return b;
    };
    if (sel.obj.type === "text" && style) {
      add("edit", t("pdfcraft.editText"), () => this.editSelection());
      add("bold", t("pdfcraft.bold"), () => void this.toggle("bold"), style.bold);
      add("italic", t("pdfcraft.italic"), () => void this.toggle("italic"), style.italic);
      add("smaller", t("pdfcraft.smaller"), () => void this.resizeText(-2));
      add("larger", t("pdfcraft.larger"), () => void this.resizeText(2));
      add("family", t("pdfcraft.font"), () => void this.nextFamily());
      const color = add("color", t("pdfcraft.color"), () => {});
      const input = el("input");
      input.type = "color";
      input.value = hex(style.color);
      input.setAttribute("aria-label", t("pdfcraft.color"));
      input.addEventListener("change", () => void this.styleSelection({ color: rgb(input.value) }));
      const dot = el("span", "ot-pc-dot");
      dot.style.background = hex(style.color);
      color.append(input, dot);
      add("alignLeft", t("pdfcraft.alignLeft"), () => void this.styleSelection({ align: "left" }), style.align === "left" || style.align === null);
      add("alignCenter", t("pdfcraft.alignCenter"), () => void this.styleSelection({ align: "center" }), style.align === "center");
      add("alignRight", t("pdfcraft.alignRight"), () => void this.styleSelection({ align: "right" }), style.align === "right");
    }
    add("delete", t("pdfcraft.deleteObject"), () => void this.deleteSelection());
    slot.appendChild(bar);
    this.floatEl = bar;
    this.placeFloat(bar, sel.page, sel.obj.view);
  }

  /** Puts a floating bar above `box` on its page, or below when there is no room above; kept inside the page. */
  private placeFloat(bar: HTMLElement, page: number, box: Box): void {
    const z = this.zoom;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const pageW = this.layout.widths[page] ?? 0;
    bar.style.left = `${Math.min(Math.max(0, box[0] * z), Math.max(0, pageW - w))}px`;
    const above = box[1] * z - h - 10;
    bar.style.top = `${above >= 0 ? above : box[3] * z + 10}px`;
  }

  private dragMove(ev: PointerEvent, sel: Selection, box: HTMLElement, isText: boolean): void {
    ev.preventDefault();
    ev.stopPropagation();
    const start = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    box.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (moved) box.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = (e: PointerEvent) => {
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerup", up);
      box.removeEventListener("pointercancel", up);
      box.style.transform = "";
      const dx = (e.clientX - start.x) / this.zoom;
      const dy = (e.clientY - start.y) / this.zoom;
      if (moved && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) void this.commitMove(sel, dx, dy);
      else if (isText) this.editSelection(); // a tap on the selected text edits it
    };
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
  }

  private dragHandle(ev: PointerEvent, handle: Handle, sel: Selection, box: HTMLElement): void {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.currentTarget as HTMLElement;
    const start = { x: ev.clientX, y: ev.clientY };
    const page = this.sizes[sel.page]!;
    let next: Box = sel.obj.view;
    target.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      next = resizeBox(sel.obj.view, handle, (e.clientX - start.x) / this.zoom, (e.clientY - start.y) / this.zoom, 12, page);
      box.style.left = `${next[0] * this.zoom}px`;
      box.style.top = `${next[1] * this.zoom}px`;
      box.style.width = `${(next[2] - next[0]) * this.zoom}px`;
      box.style.height = `${(next[3] - next[1]) * this.zoom}px`;
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (next !== sel.obj.view) void this.commitResize(sel, next);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  private ref(sel: Selection): ObjectRef {
    return { kind: sel.obj.kind, index: sel.obj.index };
  }

  private async commitMove(sel: Selection, dx: number, dy: number): Promise<void> {
    if (!this.doc) return;
    await this.run(sel.page, () => this.commit({ op: "moveObjects", page: sel.page, targets: [this.ref(sel)], dx, dy }), sel);
  }

  private async commitResize(sel: Selection, box: Box): Promise<void> {
    if (!this.doc) return;
    await this.run(sel.page, () => this.commit({ op: "resizeObject", page: sel.page, target: this.ref(sel), view: box }), sel);
  }

  /**
   * Runs an edit on a page, then draws it again and keeps the object selected when it can still be
   * found where it was (existing paragraphs are grouped again after an edit, so their index can move).
   */
  private async run(page: number, edit: () => Promise<void>, keep: Selection | null = null, pick?: (list: PageObject[]) => PageObject | undefined): Promise<void> {
    try {
      await edit();
    } catch (e) {
      this.host.notifications.error(t("pdfcraft.editFailed", { message: message(e) }));
      this.renderSelection();
      return;
    }
    this.afterEdit([page]);
    if (!keep && !pick) return;
    const list = await this.objects(page);
    const found = pick ? pick(list) : list.find((o) => o.kind === keep!.obj.kind && o.index === keep!.obj.index && o.type === keep!.obj.type);
    this.select(found ? { page, obj: found } : null);
  }

  private async styleSelection(style: TextStyle): Promise<void> {
    const sel = this.sel;
    if (!sel || !this.doc || sel.obj.type !== "text") return;
    await this.run(sel.page, () => this.commit({ op: "setText", page: sel.page, target: this.ref(sel), style }), sel);
  }

  private async nextFamily(): Promise<void> {
    const current = this.sel?.obj.style?.family;
    if (!current) return;
    await this.styleSelection({ family: FAMILIES[(FAMILIES.indexOf(current) + 1) % FAMILIES.length]! });
  }

  private async toggle(which: "bold" | "italic"): Promise<void> {
    const style = this.sel?.obj.style;
    if (style) await this.styleSelection({ [which]: !style[which] });
  }

  private async resizeText(delta: number): Promise<void> {
    const style = this.sel?.obj.style;
    if (style) await this.styleSelection({ size: Math.min(400, Math.max(4, Math.round(style.size + delta))) });
  }

  private async deleteSelection(): Promise<void> {
    const sel = this.sel;
    if (!sel || !this.doc) return;
    this.select(null);
    const ann = sel.ann;
    if (ann) await this.run(sel.page, () => this.commit({ op: "deleteAnnotation", page: sel.page, index: ann.index }));
    else await this.run(sel.page, () => this.commit({ op: "deleteObject", page: sel.page, target: this.ref(sel) }));
  }

  // ------------------------------------------------------------------ cover, images

  private startRubber(page: number, from: [number, number]): void {
    const rubber = el("div", "ot-pc-rubber");
    this.slots[page]!.box.appendChild(rubber);
    this.rubber = { page, from, el: rubber };
    this.drawRubber(from);
  }

  private drawRubber(to: [number, number]): void {
    if (!this.rubber) return;
    const [x0, y0, x1, y1] = boxBetween(this.rubber.from, to, this.sizes[this.rubber.page]!);
    const s = this.rubber.el.style;
    s.left = `${x0 * this.zoom}px`;
    s.top = `${y0 * this.zoom}px`;
    s.width = `${(x1 - x0) * this.zoom}px`;
    s.height = `${(y1 - y0) * this.zoom}px`;
  }

  private cancelRubber(): void {
    this.rubber?.el.remove();
    this.rubber = null;
  }

  private async finishRubber(to: [number, number]): Promise<void> {
    const rubber = this.rubber;
    this.cancelRubber();
    if (!rubber || !this.doc) return;
    const box = boxBetween(rubber.from, to, this.sizes[rubber.page]!);
    if (box[2] - box[0] < 4 || box[3] - box[1] < 4) return;
    await this.run(rubber.page, () => this.commit({ op: "cover", page: rubber.page, view: box }));
    this.setTool("select");
  }

  private async pickedImage(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = "";
    if (!file || !this.doc) return;
    const page = this.currentIndex();
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      this.fail(e);
      return;
    }
    // the new picture is the last added item: select it so it can be moved and sized straight away
    await this.run(page, () => this.commit({ op: "addImage", page, name: file.name, bytes }), null, (list) => [...list].reverse().find((o) => o.kind === "added" && o.type === "image"));
    this.setTool("select");
  }

  // ------------------------------------------------------------------ editing text

  private editSelection(): void {
    const sel = this.sel;
    if (!sel || sel.obj.type !== "text" || this.editing) return;
    this.startEdit(sel.page, sel.obj, sel.obj.view);
  }

  /** Opens the text box over `box` for an existing text object, or for a new one (`obj` null). */
  private startEdit(page: number, obj: PageObject | null, box: Box, field?: { value: string; save: (text: string) => Promise<void> }): void {
    const slot = this.slots[page]?.box;
    if (!slot) return;
    this.cancelEdit();
    this.selEl?.remove();
    this.floatEl?.remove();
    const z = this.zoom;
    const [x0, y0, x1, y1] = box;
    const area = el("textarea", "ot-pc-edit");
    area.value = plainLetters(field?.value ?? obj?.text ?? "");
    area.spellcheck = false;
    const minH = Math.max((y1 - y0) * z + 6, 32);
    area.style.left = `${x0 * z - 2}px`;
    area.style.top = `${y0 * z - 2}px`;
    area.style.width = `${Math.max((x1 - x0) * z + 8, 90)}px`;
    area.style.height = `${minH}px`;
    area.style.fontSize = `${Math.max(11, (obj?.style?.size ?? 12) * z)}px`;
    const bar = el("div", "ot-pc-edit-bar");
    const done = el("button", "btn icon");
    const cancel = el("button", "btn icon");
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
    const grown = Math.min(Math.max(area.scrollHeight + 4, minH), 360);
    area.style.height = `${grown}px`;
    bar.style.left = `${x0 * z - 2}px`;
    bar.style.top = `${y0 * z - 2 + grown + 4}px`;
    this.editing = { page, obj, box, area, bar, field };
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
    if (!commit) {
      this.renderSelection();
      return;
    }
    if (edit.field) {
      const save = edit.field.save;
      if (text !== edit.field.value) await this.run(edit.page, () => save(text));
      return;
    }
    if (edit.obj) {
      const obj = edit.obj;
      if (text === plainLetters(obj.text ?? "")) {
        this.renderSelection();
        return;
      }
      await this.run(edit.page, () => this.commit({ op: "setText", page: edit.page, target: { kind: obj.kind, index: obj.index }, text }), { page: edit.page, obj });
    } else if (text.trim()) {
      await this.run(edit.page, () => this.commit({ op: "addText", page: edit.page, view: edit.box, text }), null, (list) => [...list].reverse().find((o) => o.kind === "added" && o.type === "text"));
      this.setTool("select");
    }
  }

  // ------------------------------------------------------------------ page operations and history

  private afterEdit(pages: number[] | "all"): void {
    this.edited = true;
    this.gen++;
    if (pages === "all") {
      this.objectCache.clear();
      this.extraCache.clear();
    } else {
      for (const p of pages) {
        this.objectCache.delete(p);
        this.extraCache.delete(p);
      }
    }
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
      if (op === "rotate") await this.commit({ op: "rotatePages", pages: [page], degrees: 90 });
      else if (op === "up" && page > 0) await this.commit({ op: "movePages", pages: [page], to: page - 1 });
      else if (op === "down" && page < count - 1) await this.commit({ op: "movePages", pages: [page], to: page + 1 });
      else if (op === "blank") {
        const s = this.sizes[page] ?? { w: 612, h: 792 };
        await this.commit({ op: "insertBlankPage", at: page + 1, width: s.w, height: s.h });
      } else if (op === "delete" && count > 1) await this.commit({ op: "deletePages", pages: [page] });
      else return;
    } catch (e) {
      this.fail(e);
      return;
    }
    await this.reloadPages(op === "up" ? page - 1 : op === "down" || op === "blank" ? page + 1 : Math.min(page, this.sizes.length));
  }

  private async history(which: "undo" | "redo"): Promise<void> {
    if (!this.doc) return;
    try {
      if (this.shared) await (which === "undo" ? this.shared.undo() : this.shared.redo());
      else await this.doc.execute({ op: which });
    } catch (e) {
      this.fail(e);
      return;
    }
    await this.reloadPages(this.currentIndex());
  }

  /** The page list may have changed: read it again, redraw, and come back to `page`. */
  private async reloadPages(page: number): Promise<void> {
    const before = this.scroller.scrollTop;
    this.sel = null;
    await this.loadPages();
    // A turned page can be wider than the view: fit again unless the person chose a zoom.
    if (this.fitKind) this.setZoom(this.fitKind === "page" ? fitPageZoom(this.scroller.clientWidth || 360, this.scroller.clientHeight || 640, this.sizes[Math.min(page, this.sizes.length - 1)] ?? { w: 612, h: 792 }) : fitZoom(this.scroller.clientWidth || 360, this.sizes), false);
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

  /** What the other peers start from: the file as this session began, or the document as it is now. */
  async collabBase(): Promise<Uint8Array> {
    if (this.sessionBase) return this.sessionBase;
    this.pendingBase = await this.getBytes();
    return this.pendingBase;
  }

  collab(): CollabBinding {
    return {
      bind: (ctx) => this.joinSession(ctx),
      unbind: () => this.leaveSession(),
    };
  }

  private async joinSession(ctx: CollabContext): Promise<void> {
    const base = ctx.seed ? (this.pendingBase ?? (await this.getBytes())) : this.original;
    this.pendingBase = null;
    this.sessionBase = base;
    this.viewOnly = ctx.readOnly;
    // every peer starts from the same file, so the same edits give the same document
    this.doc?.close();
    this.doc = await openPdf(base, { password: this.password, worker: new PdfWorker() });
    const doc = this.doc;
    this.shared = new PdfLog({ doc: ctx.doc as never, readOnly: ctx.readOnly, blobs: ctx.blobs }, { run: (call) => doc.execute(call), undo: () => doc.execute({ op: "undo" }) }, (change) => this.onSharedChange(change));
    await this.shared.start();
    for (const k of ["text", "image", "cover", "textsel", "pages"]) if (this.buttons[k]) this.buttons[k]!.disabled = this.viewOnly;
    await this.reloadPages(this.currentIndex());
    await this.refreshHistory();
  }

  private leaveSession(): void {
    this.shared?.stop();
    this.shared = null;
    this.sessionBase = null;
    this.viewOnly = false;
    for (const k of ["text", "image", "cover", "textsel", "pages"]) if (this.buttons[k]) this.buttons[k]!.disabled = false;
    void this.refreshHistory();
  }

  /** The log changed the document: a lone edit of ours is already on screen, anything else needs a redraw. */
  private onSharedChange(change: Change): void {
    if (this.disposed) return;
    if (this.localEdits > 0 && change.undone === 0 && change.applied === 1) return;
    this.edited = true;
    void this.reloadPages(this.currentIndex()).then(() => this.refreshHistory());
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
    window.clearTimeout(this.findTimer);
    window.removeEventListener("resize", this.onResize);
    this.cancelEdit();
    this.cancelRubber();
    this.release(null);
    this.doc?.close();
    this.doc = null;
    this.root?.remove();
  }
}

export const pdfCraftEditor: EditorModule = {
  create: (host) => new PdfCraftInstance(host),
};
