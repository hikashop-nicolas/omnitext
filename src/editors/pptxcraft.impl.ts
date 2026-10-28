import { unzipSync, strFromU8 } from "fflate";
import { EngineError, deckFontUrls, openDeck, type DeckSession, type Overlay, type SelectedShape } from "craftbridge/deck";
import DeckWorker from "craftbridge/deck/worker?worker";
import type { EditorInstance, EditorMountContext, EditorModule, HostAPI } from "../core/types";
import { getLocale, t } from "../i18n";
import { formDialog, messageDialog, saveFile } from "./pdfcraft-tools";
import { Inspector, type InspectorHost } from "./pptxcraft-inspector";
import { ShowRunner, type ShowHost, type Surface } from "./pptxcraft-show";
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
    .ot-px-bar, .ot-px-bottom { flex:0 0 auto; display:flex; align-items:center; gap:6px; padding:6px 8px; overflow-x:auto;
      border-bottom:1px solid var(--border); background:var(--surface); scrollbar-width:none; }
    .ot-px-bottom { border-bottom:0; border-top:1px solid var(--border); }
    @media (max-width:720px) { .ot-px-bar { flex-wrap:wrap; overflow-x:visible; } .ot-px-bar .sep { display:none; } }
    .ot-px-bar .btn, .ot-px-bottom .btn, .ot-px-float .btn, .ot-px-slidebar .btn { flex:0 0 auto; position:relative; }
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
    .ot-px-insp { flex:0 0 288px; overflow-y:auto; border-left:1px solid var(--border); background:var(--surface); padding:6px 10px 40px; font:13px system-ui, sans-serif; }
    @media (max-width:720px) { .ot-px-insp { position:absolute; z-index:9; top:0; bottom:0; right:0; width:min(320px, 92vw); box-shadow:-4px 0 16px rgba(0,0,0,.35); } }
    .ot-px-sec { border-bottom:1px solid var(--border); padding:4px 0 8px; }
    .ot-px-sec > summary { cursor:pointer; padding:6px 0; font-weight:600; list-style-position:inside; }
    .ot-px-field { display:flex; align-items:center; gap:8px; margin:5px 0; }
    .ot-px-field > label { flex:0 0 84px; color:var(--muted); font-size:12px; }
    .ot-px-ctl { flex:1 1 auto; display:flex; flex-wrap:wrap; gap:4px; align-items:center; min-width:0; }
    .ot-px-ctl input[type=number] { width:72px; min-width:0; font:inherit; padding:4px 6px; color:var(--text); background:var(--canvas); border:1px solid var(--border); border-radius:6px; }
    .ot-px-ctl input[type=text] { flex:1 1 100px; min-width:0; font:inherit; padding:4px 6px; color:var(--text); background:var(--canvas); border:1px solid var(--border); border-radius:6px; }
    .ot-px-ctl select { flex:1 1 90px; min-width:0; font:inherit; padding:4px 6px; color:var(--text); background:var(--canvas); border:1px solid var(--border); border-radius:6px; }
    .ot-px-check { display:flex; align-items:center; gap:5px; }
    .ot-px-sbtn { padding:4px 8px; min-width:30px; font:inherit; }
    .ot-px-sw { width:30px; height:26px; padding:0; border:1px solid var(--border); }
    .ot-px-anim { display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin:4px 0; }
    .ot-px-anim > span { flex:1 1 100%; }
    .ot-px-hint { color:var(--muted); margin:4px 0; }
    .ot-px-banner { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:6px 10px; background:var(--accent); color:var(--accent-fg); font:600 13px system-ui, sans-serif; }
    .ot-px-banner .btn { padding:4px 10px; }
    .ot-px-mh { font:600 12px system-ui, sans-serif; color:var(--muted); padding:4px 2px 0; }
    .ot-px-thumb.picked .frame { border-color:var(--accent); }
    .ot-px-thumb.hidden .frame { opacity:.4; }
    .ot-px-sechead { display:flex; align-items:center; gap:6px; margin:8px 0 -4px; font:600 12px system-ui, sans-serif; color:var(--muted); }
    .ot-px-sechead span { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ot-px-sechead button { padding:0 6px; border:0; background:none; color:inherit; cursor:pointer; font-size:16px; }
    .ot-px-notes { flex:0 0 auto; border-top:1px solid var(--border); background:var(--surface); display:flex; }
    .ot-px-notes textarea { flex:1; height:84px; resize:vertical; margin:6px; padding:6px 8px; font:13px system-ui, sans-serif; color:var(--text);
      background:var(--canvas); border:1px solid var(--border); border-radius:7px; }
    .ot-px-bottom .grow { flex:1 1 auto; }
    .ot-px-bottom input[type=range] { flex:0 1 96px; width:96px; min-width:48px; accent-color:var(--accent); }
    .ot-px-bottom input[type=number] { flex:0 0 auto; width:56px; min-width:0; font:inherit; padding:4px 6px; color:var(--text);
      background:var(--canvas); border:1px solid var(--border); border-radius:6px; }
    @media (max-width:480px) { .ot-px-pct { display:none; } .ot-px-bottom input[type=number] { width:48px; } }
    @media (max-width:600px) { .ot-px-bottom input[type=range] { flex-basis:64px; width:64px; } }
    .ot-px-float { position:absolute; z-index:8; display:flex; flex-direction:column; white-space:nowrap; gap:4px; padding:4px; background:var(--surface);
      color:var(--text); border:1px solid var(--border); border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,.35); touch-action:none; }
    .ot-px-float .btn { padding:6px 8px; }
    .ot-px-row { display:flex; gap:4px; }
    .ot-px-slidebar { position:sticky; top:-10px; z-index:2; display:flex; gap:4px; padding:2px 0 6px; background:var(--surface); }
    .ot-px-slidebar .btn { padding:6px 8px; }
    .ot-px-bottom span { color:var(--muted); font:13px system-ui, sans-serif; white-space:nowrap; }
    .ot-px-input { position:absolute; left:-9999px; top:0; width:1px; height:1px; opacity:0; resize:none; border:0; padding:0; }
    .ot-px-menu { position:absolute; z-index:20; display:flex; flex-direction:column; min-width:170px; padding:4px; border-radius:10px;
      background:var(--surface); color:var(--text); border:1px solid var(--border); box-shadow:0 6px 20px rgba(0,0,0,.4); }
    .ot-px-menu button { display:flex; align-items:center; text-align:left; padding:9px 12px; border:0; border-radius:7px; background:none; color:inherit;
      font:14px system-ui, sans-serif; cursor:pointer; }
    .ot-px-menu button:hover, .ot-px-menu button:focus-visible, .ot-px-menu button.on { background:var(--canvas); }
    .ot-px-menu { max-height:min(70vh, 640px); overflow-y:auto; }
    .ot-px-swatches { display:grid; grid-template-columns:repeat(6, 28px); gap:6px; padding:6px; }
    .ot-px-swatch { width:28px; height:28px; border-radius:6px; border:1px solid var(--border); padding:0; cursor:pointer; }
    .ot-px-custom { position:relative; padding:8px 12px; font:14px system-ui, sans-serif; cursor:pointer; }
    .ot-px-custom input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; border:0; padding:0; }
    .ot-px-stripe { position:absolute; left:8px; right:8px; bottom:4px; height:4px; border-radius:2px; border:1px solid var(--border); }
    .ot-px-show { position:fixed; inset:0; z-index:60; background:#000; display:flex; align-items:center; justify-content:center; cursor:none; }
    .ot-px-show canvas { max-width:100%; max-height:100%; }
    .ot-px-show .ot-px-close { position:absolute; top:max(10px, env(safe-area-inset-top)); right:10px; z-index:2; width:44px; height:44px; border-radius:50%; border:0; background:rgba(0,0,0,.55); color:#fff; font-size:22px; line-height:44px; cursor:pointer; opacity:.7; }
    .ot-px-show .ot-px-close:hover, .ot-px-show .ot-px-close:focus-visible { opacity:1; }
    .ot-pv { position:fixed; inset:0; z-index:60; background:var(--canvas); color:var(--text); display:grid; grid-template-columns:3fr 2fr; grid-template-rows:1fr auto;
      gap:12px; padding:12px; font:14px system-ui, sans-serif; }
    @media (max-width:800px) { .ot-pv { grid-template-columns:1fr; grid-template-rows:auto 1fr auto; } }
    .ot-pv-main { display:flex; align-items:center; justify-content:center; min-height:0; background:#000; border-radius:8px; overflow:hidden; }
    .ot-pv-main canvas, .ot-pv-next canvas { max-width:100%; max-height:100%; }
    .ot-pv-side { display:flex; flex-direction:column; gap:12px; min-height:0; }
    .ot-pv-next { flex:0 0 34%; display:flex; align-items:center; justify-content:center; min-height:0; background:#000; border-radius:8px; overflow:hidden; }
    .ot-pv-notes { flex:1 1 auto; overflow:auto; white-space:pre-wrap; padding:10px 12px; background:var(--surface); border:1px solid var(--border); border-radius:8px;
      font-size:20px; line-height:1.4; }
    .ot-pv-notes.none { color:var(--muted); font-size:14px; }
    .ot-pv-bar { grid-column:1 / -1; display:flex; align-items:center; gap:8px; }
    .ot-pv-bar .grow { flex:1 1 auto; }
    .ot-pv-clock { font:600 20px ui-monospace, monospace; font-variant-numeric:tabular-nums; }
    .ot-pv-label { color:var(--muted); font-size:12px; margin-bottom:4px; }
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
  private inspector!: Inspector;
  private float!: HTMLElement;
  private rowText!: HTMLElement;
  private rowShape!: HTMLElement;
  private sideTools!: HTMLElement;
  private zoomRange!: HTMLInputElement;
  private zoomNum!: HTMLInputElement;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  private ignoreUntilUp = false;
  private hadSelection = false;
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
  private reuseInput!: HTMLInputElement;
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
  private masterMode = false;
  private picked = new Set<number>();
  private masterItems: { master: number; layout: number }[] = [];
  private banner!: HTMLElement;
  private masterTools!: HTMLElement;
  private thumbDirty = new Set<number>();
  private thumbPump = false;
  private thumbSlides = 0;
  private notesFor = -1;
  private resizeObserver: ResizeObserver | null = null;
  private enterAt = 0;
  private fontsLoaded = new Set<string>();
  private mediaCache = new Map<number, { bytes: Uint8Array; mime: string; name: string } | null>();
  private mediaZip: Record<string, Uint8Array> | null = null;
  private editMedia: (() => void) | null = null;
  private mediaKey = "";
  private fileName = "presentation.pptx";
  private guides: { vertical: boolean; pos: number }[] = [];
  private guidesOn = false;
  private pointsMode: number | null = null;
  private points: { paths: [number, number][][] } | null = null;
  private vertex: { path: number; index: number } | null = null;
  private customShows = new Map<string, number[]>();
  private showOrder: number[] | null = null;
  private showOpts: { loop: boolean; noAnimation: boolean; from: number; to: number } = { loop: false, noAnimation: false, from: 0, to: -1 };
  private pickKind: "image" | "video" | "audio" = "image";
  private mediaBySize = new Map<number, { bytes: Uint8Array; mime: string; name: string }>();
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
    this.float = el("div", "ot-px-float");
    this.float.hidden = true;
    this.rowText = el("div", "ot-px-row");
    this.rowShape = el("div", "ot-px-row");
    this.float.append(this.rowText, this.rowShape);
    this.sideTools = el("div", "ot-px-slidebar");
    const body = el("div", "ot-px-body");
    this.side = el("div", "ot-px-side");
    const main = el("div", "ot-px-main");
    this.stage = el("div", "ot-px-stage");
    this.slideEl = el("div", "ot-px-slide");
    this.canvas = el("canvas");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "ot-px-ov");
    this.slideEl.append(this.canvas, this.svg, this.float);
    this.stage.appendChild(this.slideEl);
    this.notesWrap = el("div", "ot-px-notes");
    this.notesWrap.hidden = true;
    this.notes = el("textarea");
    this.notes.placeholder = t("pptxcraft.notesHint");
    this.notes.setAttribute("aria-label", t("pptxcraft.notes"));
    this.notes.addEventListener("change", () => void this.setNotes());
    this.notesWrap.appendChild(this.notes);
    this.banner = el("div", "ot-px-banner");
    this.banner.hidden = true;
    const bannerLabel = el("span", undefined, t("pptxcraft.masterBanner"));
    const bannerClose = el("button", "btn", t("pptxcraft.closeMaster"));
    bannerClose.type = "button";
    bannerClose.addEventListener("click", () => void this.cmd("view.closeMaster", {}, true));
    this.banner.append(bannerLabel, bannerClose);
    main.append(this.banner, this.stage, this.notesWrap);
    const inspectorHost: InspectorHost = {
      root: this.root,
      run: (id, params, slides) => this.cmd(id, params, slides),
      query: <T>(id: string, params?: unknown): Promise<T | undefined> => {
        const session = this.session;
        return session ? (this.enqueue(() => session.execute<T>(id, params ?? {})) as Promise<T | undefined>) : Promise.resolve(undefined);
      },
      overlay: () => this.ov,
      pointsEditing: () => this.pointsMode,
      vertex: () => this.vertex,
      setEditingPoints: (on) => this.setEditingPoints(on),
    };
    this.inspector = new Inspector(inspectorHost);
    this.inspector.el.hidden = true;
    body.append(this.side, main, this.inspector.el);
    this.input = el("textarea", "ot-px-input");
    this.input.setAttribute("aria-label", t("pptxcraft.typing"));
    this.input.autocapitalize = "off";
    this.input.spellcheck = false;
    this.input.inputMode = "none";
    this.fileInput = el("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => void this.pickedPicture());
    this.reuseInput = el("input");
    this.reuseInput.type = "file";
    this.reuseInput.accept = ".pptx,.potx,.ppsx";
    this.reuseInput.hidden = true;
    this.reuseInput.addEventListener("change", () => void this.reuseChosen());
    const bottom = this.buildBottom();
    this.root.append(this.bar, body, bottom, this.input, this.fileInput, this.reuseInput);
    container.appendChild(this.root);
    this.buildBar();
    this.buildFloat();
    this.buildSideTools();
    this.side.classList.toggle("closed", window.innerWidth <= 720);
    this.wire();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitting) this.fit();
    });
    this.resizeObserver.observe(this.stage);
    this.original = ctx.bytes ?? new Uint8Array();
    this.fileName = ctx.filename ?? this.fileName;
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
    this.buttons.undo = this.button("undo", t("pptxcraft.undo"), () => void this.cmd("edit.undo"));
    this.buttons.redo = this.button("redo", t("pptxcraft.redo"), () => void this.cmd("edit.redo"));
    this.sepTo(b);
    this.buttons.select = this.button("select", t("pptxcraft.select"), () => this.setTool("select"));
    this.buttons.text = this.button("text", t("pptxcraft.textBox"), () => this.setTool("textBox"));
    this.buttons.shapes = this.button("shapes", t("pptxcraft.shapes"), () => this.shapesMenu());
    this.buttons.insert = this.button("insert", t("pptxcraft.insert"), () => this.insertMenu());
    this.sepTo(b);
    this.buttons.newSlide = this.button("slideNew", t("pptxcraft.newSlide"), () => this.newSlideMenu());
    this.sepTo(b);
    this.buttons.present = this.button("present", t("pptxcraft.present"), () => this.presentMenu());
    this.buttons.notes = this.button("notes", t("pptxcraft.notes"), () => this.toggleNotes());
    this.buttons.tools = this.button("tools", t("pptxcraft.tools"), () => this.toolsMenu());
  }

  private colorButton(into: HTMLElement, name: IconName, title: string, run: (anchor: HTMLButtonElement) => void): HTMLButtonElement {
    const b = this.button(name, title, () => run(b), into);
    const stripe = el("span", "ot-px-stripe");
    stripe.style.background = "var(--muted)";
    b.appendChild(stripe);
    return b;
  }

  private buildMasterTools(): void {
    this.masterTools = el("div", "ot-px-slidebar");
    this.button("slideNew", t("pptxcraft.insertLayout"), () => void this.cmd("master.insertLayout", {}, true), this.masterTools);
    this.button("copy", t("pptxcraft.renameLayout"), () => void this.renameLayout(), this.masterTools);
    this.button("trash", t("pptxcraft.deleteLayout"), () => void this.cmd("master.deleteLayout", {}, true), this.masterTools);
  }

  private async addSection(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.addSection"), [{ key: "name", label: t("pptxcraft.name"), kind: "text", value: "" }]);
    if (v) await this.cmd("section.add", { name: String(v.name).trim() || undefined, at: this.ov.slide ?? 0 }, true);
  }

  private async renameLayout(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.renameLayout"), [{ key: "name", label: t("pptxcraft.name"), kind: "text", value: "" }]);
    if (v && String(v.name).trim()) await this.cmd("master.renameLayout", { name: String(v.name).trim() }, true);
  }

  private buildSideTools(): void {
    this.buildMasterTools();
    this.buttons.dupSlide = this.button("copy", t("pptxcraft.duplicateSlide"), () => void this.slideAction("duplicate"), this.sideTools);
    this.buttons.delSlide = this.button("trash", t("pptxcraft.deleteSlide"), () => void this.slideAction("delete"), this.sideTools);
    this.buttons.up = this.button("up", t("pptxcraft.moveUp"), () => void this.slideAction("up"), this.sideTools);
    this.buttons.down = this.button("down", t("pptxcraft.moveDown"), () => void this.slideAction("down"), this.sideTools);
    this.button("insert", t("pptxcraft.addSection"), () => void this.addSection(), this.sideTools);
  }

  private buildFloat(): void {
    const s = this.rowText;
    const r = this.rowShape;
    const sb = this.subButtons;
    sb.bold = this.button("bold", t("pptxcraft.bold"), () => void this.cmd("format.bold"), s);
    sb.italic = this.button("italic", t("pptxcraft.italic"), () => void this.cmd("format.italic"), s);
    sb.underline = this.button("underline", t("pptxcraft.underline"), () => void this.cmd("format.underline"), s);
    sb.larger = this.button("larger", t("pptxcraft.larger"), () => void this.cmd("format.grow"), s);
    sb.smaller = this.button("smaller", t("pptxcraft.smaller"), () => void this.cmd("format.shrink"), s);
    sb.textColor = this.colorButton(s, "textColor", t("pptxcraft.textColor"), (a) =>
      colorMenu(this.root, a, { custom: t("pptxcraft.custom") }, (c) => c && void this.cmd("format.color", { color: c })),
    );
    sb.alignLeft = this.button("alignLeft", t("pptxcraft.alignLeft"), () => void this.cmd("format.align", { align: "left" }), s);
    sb.alignCenter = this.button("alignCenter", t("pptxcraft.alignCenter"), () => void this.cmd("format.align", { align: "center" }), s);
    sb.alignRight = this.button("alignRight", t("pptxcraft.alignRight"), () => void this.cmd("format.align", { align: "right" }), s);
    sb.bullets = this.button("bullets", t("pptxcraft.bullets"), () => void this.cmd("format.bullets"), s);
    sb.fill = this.colorButton(r, "fill", t("pptxcraft.fill"), (a) =>
      colorMenu(this.root, a, { none: t("pptxcraft.noFill"), custom: t("pptxcraft.custom") }, (c) => void this.cmd("shape.fill", c ? { color: c } : { none: true })),
    );
    sb.line = this.colorButton(r, "line", t("pptxcraft.outline"), (a) =>
      colorMenu(this.root, a, { none: t("pptxcraft.noLine"), custom: t("pptxcraft.custom") }, (c) => void this.cmd("shape.line", c ? { color: c } : { none: true })),
    );
    sb.toFront = this.button("toFront", t("pptxcraft.toFront"), () => void this.cmd("arrange.bringToFront"), r);
    sb.toBack = this.button("toBack", t("pptxcraft.toBack"), () => void this.cmd("arrange.sendToBack"), r);
    sb.duplicate = this.button("copy", t("pptxcraft.duplicate"), () => void this.cmd("edit.duplicate"), r);
    sb.remove = this.button("trash", t("pptxcraft.delete"), () => void this.cmd("edit.delete"), r);
  }

  private buildBottom(): HTMLElement {
    const bottom = el("div", "ot-px-bottom");
    this.button("slides", t("pptxcraft.slides"), () => this.side.classList.toggle("closed"), bottom);
    this.button("sliders", t("pptxcraft.inspector"), () => {
      this.inspector.el.hidden = !this.inspector.el.hidden;
      if (!this.inspector.el.hidden) void this.inspector.refresh();
      if (this.fitting) requestAnimationFrame(() => this.fit());
    }, bottom);
    this.buttons.prev = this.button("up", t("pptxcraft.previous"), () => void this.cmd("slide.previous", {}), bottom);
    this.buttons.next = this.button("down", t("pptxcraft.next"), () => void this.cmd("slide.next", {}), bottom);
    this.counter = el("span");
    bottom.append(this.counter, el("span", "grow"));
    this.button("fit", t("pptxcraft.fit"), () => this.fit(), bottom);
    this.zoomRange = el("input");
    this.zoomRange.type = "range";
    this.zoomRange.min = String(MIN_ZOOM * 100);
    this.zoomRange.max = String(MAX_ZOOM * 100);
    this.zoomRange.step = "5";
    this.zoomRange.value = "100";
    this.zoomRange.title = t("pptxcraft.zoomLevel");
    this.zoomRange.setAttribute("aria-label", t("pptxcraft.zoomLevel"));
    this.zoomNum = el("input");
    this.zoomNum.type = "number";
    this.zoomNum.min = String(MIN_ZOOM * 100);
    this.zoomNum.max = String(MAX_ZOOM * 100);
    this.zoomNum.value = "100";
    this.zoomNum.setAttribute("aria-label", t("pptxcraft.zoomPercent"));
    this.zoomRange.addEventListener("input", () => this.userZoom(Number(this.zoomRange.value)));
    this.zoomNum.addEventListener("change", () => this.userZoom(Number(this.zoomNum.value)));
    bottom.append(this.zoomRange, this.zoomNum, el("span", "ot-px-pct", "%"));
    return bottom;
  }

  private userZoom(percent: number): void {
    if (!Number.isFinite(percent) || percent <= 0) return;
    this.setZoom(percent / 100, false);
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
    const mm = !!ov.target && ov.target.kind !== "slides";
    if (mm !== this.masterMode) {
      this.masterMode = mm;
      this.banner.hidden = !mm;
      this.renderedKey = "";
      this.syncSlides(true);
    }
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
      if (this.masterMode) {
        const at = this.thumbs.findIndex((r) => r.classList.contains("on"));
        if (at >= 0) this.thumbDirty.add(at);
      } else this.thumbDirty.add(ov.slide ?? 0);
      this.pumpThumbs();
      this.onChange();
    }
    if (ov.revision !== undefined) this.lastRevision = ov.revision;
    if (ov.slides !== undefined && ov.slides !== this.thumbSlides) this.syncSlides(true);
    if (this.masterMode) this.markActiveThumb();
    await this.syncPoints();
    if (this.guides.length || this.guidesOn) this.guides = (await session.execute<{ vertical: boolean; pos: number }[]>("guide.list", {}).catch(() => [])) ?? [];
    this.drawOverlay();
    this.updateButtons();
    this.syncEditMedia();
    if (!this.dragging) this.inspector.schedule();
    const mode = ov.text ? "text" : "none";
    if (this.input.inputMode !== mode) {
      this.input.inputMode = mode;
      if (document.activeElement === this.input) this.input.blur();
    }
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
      const r = await session.render(this.ov.slide ?? 0, Math.min(this.zoom * this.dpr, 4096 / this.slideW), true);
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

  /** While a shape's points are edited, keeps their positions at hand; leaves the mode when the selection moves on. */
  private async syncPoints(): Promise<void> {
    const session = this.session;
    if (this.pointsMode === null || !session) return;
    const sel = this.ov.selection ?? [];
    if (sel.length !== 1 || sel[0]!.id !== this.pointsMode) {
      this.pointsMode = null;
      this.points = null;
      this.vertex = null;
      return;
    }
    this.points = (await session.execute<{ paths: [number, number][][] }>("shape.points", { id: this.pointsMode }).catch(() => null)) ?? null;
  }

  async setEditingPoints(on: boolean): Promise<void> {
    const sel = this.ov.selection ?? [];
    if (on && sel.length !== 1) return;
    this.pointsMode = on ? sel[0]!.id : null;
    this.vertex = null;
    this.points = null;
    await this.cmd("shape.editPoints", { on, id: sel[0]?.id });
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
      if (!s.locked && !editing && this.pointsMode !== s.id) this.drawHandles(kids, s, px, accent);
    }
    const cells = this.ov.cells;
    if (cells) kids.push(this.svgEl("rect", { x: cells[0], y: cells[1], width: cells[2], height: cells[3], fill: "rgba(42,109,244,.25)", stroke: accent, "stroke-width": 1.5 * px }));
    for (const g of this.guides) {
      const a = g.vertical ? { x1: g.pos, y1: 0, x2: g.pos, y2: this.slideH } : { x1: 0, y1: g.pos, x2: this.slideW, y2: g.pos };
      kids.push(this.svgEl("line", { ...a, stroke: "#d6409f", "stroke-width": px, "stroke-dasharray": `${6 * px} ${4 * px}` }));
    }
    if (this.pointsMode !== null && this.points) {
      this.points.paths.forEach((path, pi) => {
        path.forEach((pt, i) => {
          const on = this.vertex?.path === pi && this.vertex.index === i;
          kids.push(this.svgEl("rect", { x: pt[0] - 4 * px, y: pt[1] - 4 * px, width: 8 * px, height: 8 * px, fill: on ? accent : "#fff", stroke: accent, "stroke-width": 1.5 * px }));
        });
      });
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
    this.placeFloat();
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
    this.setZoom(this.zoom * f, false);
  }

  private setZoom(z: number, fitting: boolean): void {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (Math.abs(zoom - this.zoom) < 1e-4 && this.renderedKey) return;
    this.zoom = zoom;
    this.fitting = fitting;
    this.zoomRange.value = String(Math.round(zoom * 100));
    this.zoomNum.value = String(Math.round(zoom * 100));
    this.applySize();
    this.drawOverlay();
    this.syncEditMedia();
    if (this.ov.open) void this.renderMain(`${this.ov.slide}:${this.ov.revision}:${this.zoom.toFixed(3)}`);
  }

  // ------------------------------------------------------------------ the slide strip

  private syncMasterStrip(): void {
    const session = this.session;
    if (!session) return;
    this.side.replaceChildren(this.masterTools);
    this.thumbs = [];
    this.masterItems = [];
    void this.enqueue(() => session.masters()).then((masters) => {
      if (!this.masterMode || !masters) return;
      masters.forEach((m, mi) => {
        const add = (label: string, layout: number): void => {
          const idx = this.masterItems.length;
          this.masterItems.push({ master: mi, layout });
          if (layout < 0) this.side.appendChild(el("div", "ot-px-mh", m.name));
          const row = el("div", "ot-px-thumb");
          row.append(el("span", undefined, layout < 0 ? "M" : String(layout + 1)));
          const frame = el("div", "frame");
          frame.appendChild(el("canvas"));
          row.appendChild(frame);
          row.title = label;
          row.addEventListener("click", () => void this.cmd("view.slideMaster", layout < 0 ? { master: mi } : { master: mi, layout }));
          this.side.appendChild(row);
          this.thumbs.push(row);
          this.thumbDirty.add(idx);
        };
        add(m.name, -1);
        m.layouts.forEach((l, li) => add(l.name, li));
      });
      this.markActiveThumb();
      this.pumpThumbs();
    });
  }

  private syncSlides(all = false): void {
    if (this.masterMode) {
      if (all) this.syncMasterStrip();
      return;
    }
    const n = this.ov.slides ?? 0;
    if (all || n !== this.thumbSlides || this.thumbs.length !== n) {
      this.thumbSlides = n;
      this.side.replaceChildren(this.sideTools);
      this.thumbs = [];
      for (let i = 0; i < n; i++) {
        const row = el("div", "ot-px-thumb");
        row.draggable = true;
        row.append(el("span", undefined, String(i + 1)));
        const frame = el("div", "frame");
        frame.appendChild(el("canvas"));
        row.appendChild(frame);
        row.addEventListener("click", (e) => this.pickSlide(i, e));
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
      void this.decorateStrip();
    }
    this.pumpThumbs();
  }

  /** Marks hidden slides and puts the section names in the strip. */
  private async decorateStrip(): Promise<void> {
    const session = this.session;
    if (!session || this.masterMode) return;
    const info = await this.enqueue(() => session.execute<{ slides?: { hidden?: boolean }[]; sections?: { name: string; slides: number }[] }>("document.inspect", {}));
    if (!info || this.masterMode) return;
    for (const h of this.side.querySelectorAll(".ot-px-sechead")) h.remove();
    info.slides?.forEach((x, i) => this.thumbs[i]?.classList.toggle("hidden", !!x.hidden));
    let at = 0;
    (info.sections ?? []).forEach((sec, si) => {
      const head = el("div", "ot-px-sechead");
      head.appendChild(el("span", undefined, sec.name));
      const more = el("button", undefined, "\u22EF");
      more.type = "button";
      more.title = t("pptxcraft.section");
      more.setAttribute("aria-label", t("pptxcraft.section"));
      more.addEventListener("click", () => this.sectionMenu(more, si, info.sections?.length ?? 0));
      head.appendChild(more);
      const row = this.thumbs[at];
      if (row) this.side.insertBefore(head, row);
      at += sec.slides;
    });
  }

  private sectionMenu(anchor: HTMLElement, index: number, count: number): void {
    popupMenu(this.root, anchor, [
      { label: t("pptxcraft.renameSection"), run: () => void this.dialog(t("pptxcraft.renameSection"), [{ key: "name", label: t("pptxcraft.name"), kind: "text", value: "" }]).then((v) => v && String(v.name).trim() && this.cmd("section.rename", { index, name: String(v.name).trim() }, true)) },
      ...(index > 0 ? [{ label: t("pptxcraft.moveUp"), run: () => void this.cmd("section.move", { index, to: index - 1 }, true) }] : []),
      ...(index < count - 1 ? [{ label: t("pptxcraft.moveDown"), run: () => void this.cmd("section.move", { index, to: index + 1 }, true) }] : []),
      { label: t("pptxcraft.removeSection"), run: () => void this.cmd("section.remove", { index }, true) },
      { label: t("pptxcraft.removeSectionSlides"), run: () => void this.cmd("section.remove", { index, slides: true }, true) },
      { label: t("pptxcraft.removeAllSections"), run: () => void this.cmd("section.removeAll", {}, true) },
    ]);
  }

  /** A click on a thumbnail: go there, or with Shift or Ctrl select several. */
  private pickSlide(i: number, e: MouseEvent): void {
    const cur = this.ov.slide ?? 0;
    if (e.shiftKey) {
      this.picked = new Set();
      for (let k = Math.min(cur, i); k <= Math.max(cur, i); k++) this.picked.add(k);
      void this.cmd("slide.selectRange", { to: i, from: cur });
    } else if (e.ctrlKey || e.metaKey) {
      if (this.picked.size === 0) this.picked.add(cur);
      if (this.picked.has(i) && this.picked.size > 1) this.picked.delete(i);
      else this.picked.add(i);
      void this.cmd("slide.selectSlides", { indices: [...this.picked] });
    } else {
      this.picked = new Set();
      void this.cmd("slide.go", { index: i });
    }
    this.thumbs.forEach((row, k) => row.classList.toggle("picked", this.picked.has(k)));
  }

  /** The slides a strip action works on: the picked ones, else the current one. */
  private targetSlides(): number[] {
    return this.picked.size > 1 ? [...this.picked].sort((a, b) => a - b) : [this.ov.slide ?? 0];
  }

  private async slideAction(kind: "delete" | "duplicate" | "up" | "down"): Promise<void> {
    const list = this.targetSlides();
    const n = this.ov.slides ?? 0;
    if (kind === "delete") {
      if (list.length >= n) return;
      for (const i of [...list].reverse()) await this.cmd("slide.delete", { index: i }, true);
    } else if (kind === "duplicate") {
      for (const [k, i] of list.entries()) await this.cmd("slide.duplicate", { index: i + k }, true);
    } else if (kind === "up") {
      if (list[0] === 0) return;
      for (const i of list) await this.cmd("slide.move", { from: i, to: i - 1 }, true);
    } else {
      if ((list[list.length - 1] ?? 0) >= n - 1) return;
      for (const i of [...list].reverse()) await this.cmd("slide.move", { from: i, to: i + 1 }, true);
    }
    this.picked = new Set();
    this.thumbs.forEach((row) => row.classList.remove("picked"));
  }

  private markActiveThumb(): void {
    if (this.masterMode) {
      const t0 = this.ov.target;
      const at = this.masterItems.findIndex((x) => x.master === (t0?.master ?? 0) && x.layout === (t0?.kind === "layout" ? (t0.layout ?? 0) : -1));
      this.thumbs.forEach((row, i) => row.classList.toggle("on", i === at));
      return;
    }
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
          const mi = this.masterItems[next];
          const scale = (THUMB_W / this.slideW) * this.dpr;
          const r = await this.enqueue(() => (this.masterMode && mi ? session.renderLayout(mi.master, mi.layout, scale) : session.render(next, scale, false)));
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
    this.placeFloat();
  }

  /** The tools for the selection, floating over it (under it when there is no room above). */
  private placeFloat(): void {
    const ov = this.ov;
    const sel = ov.selection ?? [];
    const has = (sel.length > 0 || !!ov.text) && !this.dragging && !this.pinch;
    this.float.hidden = !has;
    if (!has) return;
    this.rowShape.hidden = !!ov.text;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const o of sel) {
      for (const c of o.corners) {
        x0 = Math.min(x0, c[0]);
        y0 = Math.min(y0, c[1]);
        x1 = Math.max(x1, c[0]);
        y1 = Math.max(y1, c[1]);
      }
    }
    if (!Number.isFinite(x0)) return this.hideFloat();
    const z = this.zoom;
    const w = this.float.offsetWidth;
    const h = this.float.offsetHeight;
    const slide = this.slideEl.getBoundingClientRect();
    const view = this.stage.getBoundingClientRect();
    const left = Math.max(view.left + 4 - slide.left, Math.min(x0 * z, view.right - 4 - w - slide.left));
    this.float.style.left = `${left}px`;
    const above = y0 * z - h - 32;
    const below = y1 * z + 32;
    const room = slide.top + above >= view.top + 4;
    this.float.style.top = `${room ? above : below}px`;
  }

  private hideFloat(): void {
    this.float.hidden = true;
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
    if (!session) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) return this.startPinch(session);
    if (this.pointers.size > 2 || this.ignoreUntilUp) return;
    this.focusInput();
    const p = this.point(e);
    const mods = this.mods(e);
    this.dragging = true;
    if (this.pointers.size === 1) this.hadSelection = (this.ov.selection?.length ?? 0) > 0;
    this.hideFloat();
    const double = e.pointerType === "touch" && e.timeStamp - this.lastTap.t < 350 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 24;
    const kind = e.button === 2 ? "contextClick" : double ? "doubleClick" : e.detail === 2 && e.pointerType !== "touch" ? "doubleClick" : e.detail >= 3 ? "tripleClick" : "down";
    void this.enqueue(async () => {
      const hit = (await session.pointer({ kind, x: p.x, y: p.y, tol: p.tol, mods, pressure: e.pointerType === "pen" ? e.pressure : null })) as { vertex?: [number, number] } | null;
      if (this.pointsMode !== null) this.vertex = hit?.vertex ? { path: hit.vertex[0], index: hit.vertex[1] } : null;
      await this.refresh();
    });
  }

  private onPointerMove(e: PointerEvent): void {
    const session = this.session;
    if (!session) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) return this.movePinch();
    if (this.ignoreUntilUp) return;
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
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0 && this.ignoreUntilUp) {
      this.ignoreUntilUp = false;
      this.placeFloat();
      return;
    }
    const session = this.session;
    if (!session || !this.dragging || this.ignoreUntilUp) return;
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

  /** A second finger turns the touch into a pinch: the gesture the first finger began is ended where it stands. */
  private startPinch(session: DeckSession): void {
    const [a, b] = [...this.pointers.values()];
    if (this.dragging) {
      this.dragging = false;
      const pt = { x: a!.x, y: a!.y };
      const r = this.slideEl.getBoundingClientRect();
      const x = ((pt.x - r.left) / r.width) * this.slideW;
      const y = ((pt.y - r.top) / r.height) * this.slideH;
      this.pendingDrag = null;
      void this.enqueue(async () => {
        await session.pointer({ kind: "up", x, y, tol: 6 / this.zoom, mods: { shift: false, alt: false, cmd: false } });
        if (!this.hadSelection) await session.execute("edit.deselect", {});
        await this.refresh();
      });
    }
    this.ignoreUntilUp = true;
    this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, zoom: this.zoom };
    this.hideFloat();
  }

  private movePinch(): void {
    const pts = [...this.pointers.values()];
    if (!this.pinch || pts.length < 2) return;
    const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) || 1;
    this.setZoom(this.pinch.zoom * (dist / this.pinch.dist), false);
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

  private insertMenu(): void {
    const pick = (kind: "image" | "video" | "audio"): void => {
      this.pickKind = kind;
      this.fileInput.accept = `${kind}/*`;
      this.fileInput.click();
    };
    popupMenu(this.root, this.buttons.insert, [
      { label: t("pptxcraft.picture"), run: () => pick("image") },
      { label: t("pptxcraft.video"), run: () => pick("video") },
      { label: t("pptxcraft.audio"), run: () => pick("audio") },
      { label: t("pptxcraft.table"), run: () => void this.insertTable() },
      { label: t("pptxcraft.chart"), run: () => void this.insertChart() },
      { label: t("pptxcraft.smartArt"), run: () => void this.insertSmartArt() },
      { label: t("pptxcraft.wordArt"), run: () => void this.insertWordArt() },
      { label: t("pptxcraft.icon"), run: () => void this.insertIcon() },
      { label: t("pptxcraft.photoAlbum"), run: () => void this.insertPhotoAlbum() },
      { label: t("pptxcraft.actionButton"), run: () => void this.insertActionButton() },
      { label: t("pptxcraft.zoom"), run: () => void this.insertZoom() },
      { label: t("pptxcraft.fromOutline"), run: () => void this.fromOutline() },
      { label: t("pptxcraft.reuseSlides"), run: () => this.reuseInput.click() },
      { label: t("pptxcraft.symbol"), run: () => void this.insertSymbol() },
      { label: t("pptxcraft.link"), run: () => void this.insertLink() },
      { label: t("pptxcraft.slideNumber"), run: () => void this.cmd("insert.slideNumber") },
      { label: t("pptxcraft.date"), run: () => void this.cmd("insert.dateTime", { format: "datetime1" }) },
    ]);
  }

  private dialog(title: string, fields: Parameters<typeof formDialog>[1]["fields"], note?: string): ReturnType<typeof formDialog> {
    return formDialog(this.root, { title, ok: t("pptxcraft.ok"), cancel: t("pptxcraft.cancel"), fields, ...(note ? { note } : {}) });
  }

  private async insertChart(): Promise<void> {
    const v = await this.dialog(
      t("pptxcraft.chart"),
      [
        { key: "type", label: t("pptxcraft.chartType"), kind: "select", value: "column", options: [["column", t("pptxcraft.chColumn")], ["bar", t("pptxcraft.chBar")], ["line", t("pptxcraft.chLine")], ["pie", t("pptxcraft.chPie")], ["doughnut", t("pptxcraft.chDoughnut")], ["area", t("pptxcraft.chArea")], ["scatter", t("pptxcraft.chScatter")]] },
        { key: "grid", label: t("pptxcraft.data"), kind: "textarea", value: "\tA\tB\nQ1\t4\t3\nQ2\t6\t5\nQ3\t5\t7" },
      ],
      t("pptxcraft.dataHint"),
    );
    if (!v) return;
    const rows = String(v.grid).split(/\r?\n/).filter((r) => r.trim() !== "").map((r) => r.split("\t"));
    const names = rows[0]?.slice(1) ?? [];
    const body = rows.slice(1);
    await this.cmd("insert.chart", { type: String(v.type), categories: body.map((r) => r[0] ?? ""), series: names.map((name, i) => ({ name, values: body.map((r) => Number(r[i + 1]) || 0) })) });
  }

  private async insertSmartArt(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.smartArt"), [
      { key: "kind", label: t("pptxcraft.chartType"), kind: "select", value: "process", options: [["list", t("pptxcraft.saList")], ["process", t("pptxcraft.saProcess")], ["cycle", t("pptxcraft.saCycle")], ["hierarchy", t("pptxcraft.saHierarchy")], ["pyramid", t("pptxcraft.saPyramid")], ["matrix", t("pptxcraft.saMatrix")]] },
      { key: "items", label: t("pptxcraft.items"), kind: "textarea", value: "One\nTwo\nThree" },
    ]);
    if (!v) return;
    const items = String(v.items).split(/\r?\n/).filter((x) => x.trim() !== "");
    if (items.length) await this.cmd("insert.smartArt", { kind: String(v.kind), items });
  }

  /** Asks for files; call it straight from a click so the browser allows the picker. */
  private pickFiles(accept: string, multiple = false): Promise<File[]> {
    return new Promise((resolve) => {
      const i = el("input");
      i.type = "file";
      i.accept = accept;
      i.multiple = multiple;
      i.hidden = true;
      this.root.appendChild(i);
      const done = (files: File[]): void => {
        i.remove();
        resolve(files);
      };
      i.addEventListener("change", () => done([...(i.files ?? [])]));
      i.addEventListener("cancel", () => done([]));
      i.click();
    });
  }

  private async insertPhotoAlbum(): Promise<void> {
    const files = await this.pickFiles("image/*", true);
    if (!files.length) return;
    const v = await this.dialog(t("pptxcraft.photoAlbum"), [
      { key: "layout", label: t("pptxcraft.perPage"), kind: "select", value: "1", options: [["fit", t("pptxcraft.fitSlide")], ["1", "1"], ["2", "2"], ["4", "4"]] },
      { key: "frame", label: t("pptxcraft.frame"), kind: "select", value: "none", options: [["none", t("pptxcraft.none")], ["rect", t("pptxcraft.frameRect")], ["rounded", t("pptxcraft.frameRounded")], ["simple", t("pptxcraft.frameSimple")]] },
      { key: "captions", label: t("pptxcraft.captions"), kind: "check", value: false },
      { key: "gray", label: t("pptxcraft.grayscale"), kind: "check", value: false },
    ]);
    if (!v) return;
    const pictures = await Promise.all(files.map(async (f) => ({ name: f.name, data: base64(new Uint8Array(await f.arrayBuffer())) })));
    await this.cmd("insert.photoAlbum", { pictures, layout: String(v.layout), frame: String(v.frame), captions: !!v.captions, grayscale: !!v.gray }, true);
  }

  private async insertActionButton(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.actionButton"), [{ key: "kind", label: t("pptxcraft.actionButton"), kind: "select", value: "forward", options: [["back", t("pptxcraft.actPrevious")], ["forward", t("pptxcraft.actNext")], ["beginning", t("pptxcraft.actFirst")], ["end", t("pptxcraft.actLast")], ["home", t("pptxcraft.abHome")], ["information", t("pptxcraft.abInfo")], ["help", t("pptxcraft.abHelp")], ["custom", t("pptxcraft.abCustom")]] }]);
    if (v) await this.cmd("insert.actionButton", { kind: String(v.kind) });
  }

  private async insertZoom(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.zoom"), [
      { key: "kind", label: t("pptxcraft.zoom"), kind: "select", value: "slide", options: [["slide", t("pptxcraft.zoomSlide")], ["section", t("pptxcraft.zoomSection")], ["summary", t("pptxcraft.zoomSummary")]] },
      { key: "which", label: t("pptxcraft.whichSlides"), kind: "text", value: "", placeholder: "1,3" },
    ]);
    if (!v) return;
    const nums = String(v.which).split(",").map((x) => Number(x.trim()) - 1).filter((x) => Number.isInteger(x) && x >= 0);
    const kind = String(v.kind);
    await this.cmd("insert.zoom", { kind, ...(kind === "section" ? { sections: nums.length ? nums : [0] } : { slides: nums.length ? nums : [this.ov.slide ?? 0] }) });
  }

  private async thesaurus(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const r = await this.enqueue(() => session.execute<{ word: string; senses: { word: string; synonyms: string[] }[] }>("review.thesaurus", {}));
    if (!r) return;
    const lines = r.senses.map((x) => `${x.word}: ${x.synonyms.slice(0, 8).join(", ")}`);
    await messageDialog(this.root, { title: `${t("pptxcraft.thesaurus")}: ${r.word}`, message: lines.length ? lines.join("\n") : t("pptxcraft.noProblems"), ok: t("pptxcraft.ok") });
  }

  private async compareDeck(): Promise<void> {
    const session = this.session;
    const [file] = await this.pickFiles(".pptx");
    if (!session || !file) return;
    const data = base64(new Uint8Array(await file.arrayBuffer()));
    const r = await this.enqueue(() => session.execute<{ changes: number }>("review.compare", { data, name: file.name }));
    if (!r) return;
    const rev = await this.enqueue(() => session.execute<{ changes: { kind: string; slide: number; details?: string }[] }>("review.revisions", {}));
    const lines = (rev?.changes ?? []).slice(0, 60).map((c) => `${c.slide + 1}: ${c.kind}${c.details ? ` (${c.details})` : ""}`);
    const accept = await messageDialog(this.root, { title: t("pptxcraft.compare"), message: `${t("pptxcraft.changesCount", { n: r.changes })}\n${lines.join("\n")}`, ok: t("pptxcraft.acceptAll"), cancel: t("pptxcraft.rejectAll") });
    await this.cmd(accept ? "review.accept" : "review.reject", { all: true }, true);
    await this.cmd("review.endCompare", {}, true);
  }

  private async applyTheme(): Promise<void> {
    const [file] = await this.pickFiles(".pptx,.potx,.thmx");
    if (file) await this.cmd("design.browseTheme", { name: file.name, data: base64(new Uint8Array(await file.arrayBuffer())) }, true);
  }

  private async replaceFont(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const used = (await this.enqueue(() => session.execute<string[]>("font.used", {}))) ?? [];
    const v = await this.dialog(t("pptxcraft.replaceFont"), [
      { key: "from", label: t("pptxcraft.fromFont"), kind: "select", value: used[0] ?? "", options: used.map((f) => [f, f] as [string, string]) },
      { key: "to", label: t("pptxcraft.toFont"), kind: "text", value: "Inter" },
    ]);
    if (v && String(v.from) && String(v.to).trim()) await this.cmd("font.replace", { from: String(v.from), to: String(v.to).trim() });
  }

  private async proofingLanguage(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.language"), [{ key: "lang", label: t("pptxcraft.language"), kind: "select", value: "en-US", options: [["en-US", "English (US)"], ["en-GB", "English (UK)"], ["fr-FR", "Français"], ["de-DE", "Deutsch"], ["es-ES", "Español"], ["pt-BR", "Português (Brasil)"], ["ru-RU", "Русский"], ["ja-JP", "日本語"], ["zh-CN", "中文(简体)"], ["ko-KR", "한국어"]] }]);
    if (v) await this.cmd("format.languageAll", { lang: String(v.lang) });
  }

  private async insertIcon(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const icons = (await this.enqueue(() => session.execute<{ name: string; label: string; category: string }[]>("insert.icons", {}))) ?? [];
    if (!icons.length) return;
    const v = await this.dialog(t("pptxcraft.icon"), [{ key: "name", label: t("pptxcraft.icon"), kind: "select", value: icons[0]!.name, options: icons.map((i) => [i.name, `${i.category}: ${i.label}`] as [string, string]) }]);
    if (v) await this.cmd("insert.icon", { name: String(v.name) });
  }

  private async fromOutline(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.fromOutline"), [
      { key: "text", label: t("pptxcraft.outlineText"), kind: "textarea", value: "# Title\n- point one\n- point two\n# Next slide\n- point" },
      { key: "md", label: t("pptxcraft.markdown"), kind: "check", value: true },
    ]);
    if (v && String(v.text).trim()) await this.cmd("slide.fromOutline", { text: String(v.text), markdown: !!v.md }, true);
  }

  private async reuseChosen(): Promise<void> {
    const session = this.session;
    const file = this.reuseInput.files?.[0];
    this.reuseInput.value = "";
    if (!session || !file) return;
    const data = base64(new Uint8Array(await file.arrayBuffer()));
    const list = await this.enqueue(() => session.execute<{ slides: { index: number; title: string }[] }>("slide.reuseList", { data, name: file.name }));
    if (!list?.slides.length) return;
    const v = await this.dialog(t("pptxcraft.reuseSlides"), [
      { key: "which", label: t("pptxcraft.whichSlides"), kind: "text", value: "", placeholder: "1-3,5" },
      { key: "keep", label: t("pptxcraft.keepFormatting"), kind: "check", value: false },
    ], list.slides.map((x) => `${x.index + 1}. ${x.title}`).join("\n"));
    if (!v) return;
    const picked: number[] = [];
    for (const part of String(v.which).split(",")) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]);
      const b = Number(m[2] ?? m[1]);
      for (let i = a; i <= b; i++) picked.push(i - 1);
    }
    await this.cmd("slide.reuse", { data, name: file.name, keepFormatting: !!v.keep, ...(picked.length ? { slides: picked } : {}) }, true);
  }

  private async insertWordArt(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.wordArt"), [{ key: "text", label: t("pptxcraft.text"), kind: "text", value: "" }]);
    if (v && String(v.text).trim()) await this.cmd("insert.wordArt", { text: String(v.text) });
  }

  private async insertSymbol(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.symbol"), [{ key: "text", label: t("pptxcraft.text"), kind: "text", value: "" }]);
    if (v && String(v.text)) await this.cmd("insert.symbol", { text: String(v.text) });
  }

  private async insertLink(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.link"), [
      { key: "url", label: t("pptxcraft.address"), kind: "text", value: "https://", placeholder: "https://" },
      { key: "text", label: t("pptxcraft.text"), kind: "text", value: "" },
    ]);
    if (v && String(v.url).trim()) await this.cmd("insert.hyperlink", { url: String(v.url).trim(), ...(String(v.text).trim() ? { text: String(v.text).trim() } : {}) });
  }

  private toolsMenu(): void {
    popupMenu(this.root, this.buttons.tools, [
      { label: t("pptxcraft.findReplace"), run: () => void this.findReplace() },
      { label: t("pptxcraft.spelling"), run: () => void this.spelling() },
      { label: t("pptxcraft.accessibility"), run: () => void this.accessibility() },
      { label: t("pptxcraft.thesaurus"), run: () => void this.thesaurus() },
      { label: t("pptxcraft.compare"), run: () => void this.compareDeck() },
      { label: t("pptxcraft.language"), run: () => void this.proofingLanguage() },
      { label: t("pptxcraft.applyTheme"), run: () => void this.applyTheme() },
      { label: t("pptxcraft.replaceFont"), run: () => void this.replaceFont() },
      { label: t("pptxcraft.guideV"), run: () => void this.addGuide(true) },
      { label: t("pptxcraft.guideH"), run: () => void this.addGuide(false) },
      { label: t("pptxcraft.guideClear"), run: () => void this.clearGuides() },
      { label: t("pptxcraft.masterView"), run: () => void this.cmd("view.slideMaster", {}, true) },
      { label: t("pptxcraft.notesMaster"), run: () => void this.cmd("view.notesMaster", {}, true) },
      { label: t("pptxcraft.handoutMaster"), run: () => void this.cmd("view.handoutMaster", {}, true) },
      { label: t("pptxcraft.closeMaster"), run: () => void this.cmd("view.closeMaster", {}, true) },
      { label: t("pptxcraft.exportPdf"), run: () => void this.exportPdf() },
      { label: t("pptxcraft.exportPng"), run: () => void this.exportPng() },
      { label: t("pptxcraft.addComment"), run: () => void this.addComment() },
      { label: t("pptxcraft.comments"), run: () => void this.listComments() },
    ]);
  }

  private baseName(): string {
    return this.fileName.replace(/\.[^./\\]+$/, "") || "presentation";
  }

  private async addGuide(vertical: boolean): Promise<void> {
    this.guidesOn = true;
    await this.cmd("guide.add", { vertical });
  }

  private async clearGuides(): Promise<void> {
    const session = this.session;
    if (!session) return;
    for (let i = this.guides.length - 1; i >= 0; i--) await this.enqueue(() => session.execute("guide.delete", { index: i }));
    this.guides = [];
    this.guidesOn = false;
    await this.cmd("edit.deselect", {});
  }

  private async exportPdf(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const v = await this.dialog(t("pptxcraft.exportPdf"), [
      { key: "layout", label: t("pptxcraft.pdfLayout"), kind: "select", value: "slides", options: [["slides", t("pptxcraft.layoutSlides")], ["notes", t("pptxcraft.layoutNotes")], ["handouts", t("pptxcraft.layoutHandouts")]] },
      { key: "per", label: t("pptxcraft.perPage"), kind: "select", value: "6", options: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["6", "6"], ["9", "9"]] },
      { key: "hidden", label: t("pptxcraft.includeHidden"), kind: "check", value: false },
    ]);
    if (!v) return;
    const bytes = await this.enqueue(() => session.exportPdf({ format: "pdf", layout: String(v.layout), perPage: Number(v.per), includeHidden: !!v.hidden }));
    if (bytes) await saveFile(bytes, `${this.baseName()}.pdf`, "application/pdf");
  }

  private async exportPng(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const index = this.ov.slide ?? 0;
    const bytes = await this.enqueue(() => session.exportPng(index, 2));
    if (bytes) await saveFile(bytes, `${this.baseName()}-${index + 1}.png`, "image/png");
  }

  private async findReplace(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const v = await this.dialog(t("pptxcraft.findReplace"), [
      { key: "find", label: t("pptxcraft.find"), kind: "text", value: "" },
      { key: "with", label: t("pptxcraft.replaceWith"), kind: "text", value: "" },
      { key: "case", label: t("pptxcraft.matchCase"), kind: "check", value: false },
      { key: "whole", label: t("pptxcraft.wholeWords"), kind: "check", value: false },
      { key: "all", label: t("pptxcraft.replaceAll"), kind: "check", value: false },
    ]);
    if (!v || !String(v.find)) return;
    const base = { text: String(v.find), matchCase: !!v.case, wholeWords: !!v.whole };
    if (v.all) {
      const r = (await this.cmd("text.replace", { ...base, with: String(v.with) })) as { replaced?: number } | undefined;
      await messageDialog(this.root, { title: t("pptxcraft.findReplace"), message: t("pptxcraft.replacedCount", { n: r?.replaced ?? 0 }), ok: t("pptxcraft.ok") });
      return;
    }
    const hits = await this.enqueue(() => session.execute<{ slide: number }[]>("text.find", base));
    const first = hits?.[0];
    if (first) await this.cmd("slide.go", { index: first.slide });
    await messageDialog(this.root, { title: t("pptxcraft.findReplace"), message: t("pptxcraft.foundCount", { n: hits?.length ?? 0 }), ok: t("pptxcraft.ok") });
  }

  private async spelling(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const r = await this.enqueue(() => session.execute<{ slide: number; word?: string; suggestions?: string[] }[]>("review.spelling", {}));
    const lines = (r ?? []).slice(0, 40).map((x) => `${x.slide + 1}: ${x.word ?? ""}${x.suggestions?.length ? ` → ${x.suggestions.slice(0, 3).join(", ")}` : ""}`);
    await messageDialog(this.root, { title: t("pptxcraft.spelling"), message: lines.length ? lines.join("\n") : t("pptxcraft.noProblems"), ok: t("pptxcraft.ok") });
  }

  private async accessibility(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const r = await this.enqueue(() => session.execute<{ slide: number; issue: string }[]>("review.accessibility", {}));
    const lines = (r ?? []).slice(0, 40).map((x) => `${x.slide + 1}: ${x.issue}`);
    await messageDialog(this.root, { title: t("pptxcraft.accessibility"), message: lines.length ? lines.join("\n") : t("pptxcraft.noProblems"), ok: t("pptxcraft.ok") });
  }

  private async addComment(): Promise<void> {
    const v = await this.dialog(t("pptxcraft.addComment"), [{ key: "text", label: t("pptxcraft.comment"), kind: "textarea", value: "" }]);
    if (v && String(v.text).trim()) await this.cmd("comment.add", { text: String(v.text).trim() });
  }

  private async listComments(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const r = await this.enqueue(() => session.execute<{ author?: string; text?: string; slide?: number }[]>("comment.list", {}));
    const lines = (r ?? []).map((c) => `${(c.slide ?? 0) + 1}: ${c.text ?? ""}`);
    await messageDialog(this.root, { title: t("pptxcraft.comments"), message: lines.length ? lines.join("\n") : t("pptxcraft.noComments"), ok: t("pptxcraft.ok") });
  }

  private async pickedPicture(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = "";
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = this.pickKind;
    const r = (await this.cmd(`insert.${kind === "image" ? "picture" : kind}`, { name: file.name, data: base64(bytes) })) as { id?: number } | undefined;
    // played from these bytes until the file is saved and opened again
    if (kind !== "image") {
      const entry = { bytes, mime: file.type, name: file.name.toLowerCase() };
      this.mediaBySize.set(bytes.length, entry);
      if (typeof r?.id === "number") this.mediaCache.set(r.id, entry);
    }
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

  // ------------------------------------------------------------------ presenting

  /** The slide's audio and video shapes, with where they sit. */
  private async mediaShapes(index: number): Promise<{ id: number; box: number[]; video: boolean; autoplay: boolean; loop: boolean }[]> {
    const session = this.session;
    if (!session) return [];
    const info = await this.enqueue(() => session.execute<{ shapes?: { id: number; box: number[]; media?: { video: boolean; autoplay: boolean; loop: boolean } }[] }>("slide.inspect", { index }));
    const out: { id: number; box: number[]; video: boolean; autoplay: boolean; loop: boolean }[] = [];
    const walk = (list: typeof info extends undefined ? never : NonNullable<typeof info>["shapes"]): void => {
      for (const sh of list ?? []) {
        if (sh.media) out.push({ id: sh.id, box: sh.box, video: !!sh.media.video, autoplay: !!sh.media.autoplay, loop: !!sh.media.loop });
      }
    };
    walk(info?.shapes);
    return out;
  }

  /** The bytes of a media shape, read from the file as it was opened (media added in this session are not there yet). */
  private async mediaBytes(id: number): Promise<{ bytes: Uint8Array; mime: string; name: string } | null> {
    const session = this.session;
    if (!session) return null;
    if (this.mediaCache.has(id)) return this.mediaCache.get(id) ?? null;
    const info = await this.enqueue(() => session.execute<{ name?: string; contentType?: string; bytes?: number }>("media.info", { id }));
    let found: { bytes: Uint8Array; mime: string; name: string } | null = null;
    try {
      this.mediaZip ??= unzipSync(this.original, { filter: (f) => /^ppt\/media\//i.test(f.name) });
      const want = (info?.name ?? "").split("/").pop()?.toLowerCase() ?? "";
      const key = Object.keys(this.mediaZip).find((k) => k.split("/").pop()?.toLowerCase() === want);
      if (key) found = { bytes: this.mediaZip[key]!, mime: info?.contentType ?? "", name: want };
    } catch {
      /* the file is not a readable archive */
    }
    found ??= this.mediaBySize.get((info as { bytes?: number } | undefined)?.bytes ?? -1) ?? null;
    if (found) this.mediaCache.set(id, found);
    return found;
  }

  /** Puts a play button over each audio and video of a slide; the media plays in place, in mediaplay's player (or a bare element in another window). Returns what removes them. */
  private async mountMedia(
    host: HTMLElement,
    index: number,
    place: (box: number[]) => { left: number; top: number; w: number; h: number },
    o: { autoplay: boolean; doc?: Document },
  ): Promise<() => void> {
    const doc = o.doc ?? document;
    const shapes = await this.mediaShapes(index);
    const undo: (() => void)[] = [];
    for (const sh of shapes) {
      const r = place(sh.box);
      const slot = doc.createElement("div");
      slot.dataset.pxMedia = "1";
      slot.style.cssText = `position:absolute;pointer-events:none;left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px`;
      const btn = doc.createElement("button");
      btn.style.cssText = "position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:24px;line-height:56px;padding:0 0 0 4px;cursor:pointer;pointer-events:auto";
      btn.type = "button";
      btn.textContent = "\u25B6";
      btn.setAttribute("aria-label", t("pptxcraft.playMedia"));
      slot.appendChild(btn);
      host.appendChild(slot);
      let stop: (() => void) | null = null;
      const start = async (): Promise<void> => {
        btn.remove();
        const m = await this.mediaBytes(sh.id);
        if (!m) {
          this.host.notifications.error(t("pptxcraft.mediaMissing"));
          return;
        }
        slot.style.pointerEvents = "auto";
        slot.style.background = "#000";
        const mime = m.mime || (sh.video ? "video/mp4" : "audio/mpeg");
        if (doc === document) {
          const { createMediaPlayer, setLocale } = await import("mediaplay");
          setLocale(getLocale());
          const handle = createMediaPlayer(slot, { bytes: m.bytes, mime, filename: m.name }, { embedded: true, controls: "native", thumbnails: false, scope: false, onError: (msg) => this.host.notifications.error(msg) });
          const el = handle.getMediaElement();
          if (el) {
            el.loop = sh.loop;
            void el.play().catch(() => undefined);
          }
          stop = () => handle.destroy();
        } else {
          const v = doc.createElement(sh.video ? "video" : "audio") as HTMLMediaElement;
          const url = URL.createObjectURL(new Blob([m.bytes as BlobPart], { type: mime }));
          v.src = url;
          v.controls = true;
          v.loop = sh.loop;
          v.style.cssText = "width:100%;height:100%";
          slot.appendChild(v);
          void v.play().catch(() => undefined);
          stop = () => {
            v.pause();
            URL.revokeObjectURL(url);
          };
        }
      };
      btn.addEventListener("click", () => void start());
      undo.push(() => {
        stop?.();
        slot.remove();
      });
      if (o.autoplay && sh.autoplay) void start();
    }
    return () => undo.forEach((f) => f());
  }

  /** Keeps the editor's play buttons in step with the slide on screen. */
  private syncEditMedia(): void {
    const key = `${this.ov.slide}:${this.zoom.toFixed(3)}:${this.ov.revision}`;
    if (key === this.mediaKey || !this.ov.open) return;
    this.mediaKey = key;
    this.editMedia?.();
    this.editMedia = null;
    const z = this.zoom;
    const index = this.ov.slide ?? 0;
    void this.mountMedia(this.slideEl, index, (b) => ({ left: b[0]! * z, top: b[1]! * z, w: b[2]! * z, h: b[3]! * z }), { autoplay: false }).then((undo) => {
      if (this.mediaKey !== key || this.disposed) undo();
      else this.editMedia = undo;
    });
  }

  private async showHost(session: DeckSession, surfaces: () => Surface[], hooks: { onSlide(index: number): void; onLeave(): void }): Promise<ShowHost> {
    const info = await this.enqueue(() => session.execute<{ slides?: { hidden?: boolean }[] }>("document.inspect", {}));
    const total = this.ov.slides ?? 1;
    return {
      hidden: (info?.slides ?? []).map((x) => !!x.hidden),
      ...(this.showOrder ? { order: this.showOrder } : {}),
      loop: this.showOpts.loop,
      noAnimation: this.showOpts.noAnimation,
      range: [Math.max(0, this.showOpts.from), this.showOpts.to < 0 ? total - 1 : Math.min(total - 1, this.showOpts.to)],
      session,
      call: (fn) => this.enqueue(fn),
      total: this.ov.slides ?? 1,
      slideW: this.slideW,
      slideH: this.slideH,
      surfaces,
      transition: async (index) => {
        const info = await this.enqueue(() => session.execute<{ transition?: { kind?: string; durationMs?: number | null; advanceAfterMs?: number | null } | null }>("slide.inspect", { index }));
        const tr = info?.transition;
        return tr?.kind && tr.kind !== "none" ? { kind: tr.kind, ms: tr.durationMs ?? 700, afterMs: tr.advanceAfterMs ?? null } : null;
      },
      onSlide: hooks.onSlide,
      onLeave: hooks.onLeave,
    };
  }

  /** What clicking at a slide point does in the show: the action set on the shape there, if any. */
  private async clickAction(session: DeckSession, index: number, x: number, y: number): Promise<{ kind: string; url?: string; slide?: number } | null> {
    const hit = await this.enqueue(() => session.hit(x, y, 2));
    const id = (hit as { id?: number } | null)?.id;
    if (typeof id !== "number") return null;
    const info = await this.enqueue(() => session.execute<{ shape?: { click?: { action?: { kind: string; url?: string; slide?: number } } } }>("shape.inspect", { id }));
    const a = info?.shape?.click?.action;
    if (!a || a.kind === "none") return null;
    if (a.kind === "slide" && typeof a.slide === "number") {
      const doc = await this.enqueue(() => session.execute<{ slides?: { id: number }[] }>("document.inspect", {}));
      const at = doc?.slides?.findIndex((s) => s.id === a.slide) ?? -1;
      return at >= 0 ? { kind: "slide", slide: at } : null;
    }
    void index;
    return a;
  }

  private presentMenu(): void {
    const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    if (native) return void this.present();
    popupMenu(this.root, this.buttons.present, [
      { label: t("pptxcraft.slideshow"), run: () => void this.present() },
      { label: t("pptxcraft.fromBeginning"), run: () => void this.present(0) },
      { label: t("pptxcraft.presenterView"), run: () => void this.presenterView() },
      { label: t("pptxcraft.setupShow"), run: () => void this.setupShow() },
      { label: t("pptxcraft.customShow"), run: () => void this.customShow() },
    ]);
  }

  private async drawTo(canvas: HTMLCanvasElement, index: number, w: number, h: number, dpr: number): Promise<void> {
    const session = this.session;
    if (!session || index < 0 || index >= (this.ov.slides ?? 0)) {
      canvas.width = canvas.height = 0;
      return;
    }
    const scale = Math.max(0.05, Math.min(w / this.slideW, h / this.slideH)) * dpr;
    const r = await this.enqueue(() => session.render(index, scale, false));
    if (!r) return;
    canvas.width = r.width;
    canvas.height = r.height;
    const px = new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer, r.rgba.byteOffset, r.rgba.byteLength);
    canvas.getContext("2d")?.putImageData(new ImageData(px, r.width, r.height), 0, 0);
    canvas.style.width = `${r.width / dpr}px`;
    canvas.style.height = `${r.height / dpr}px`;
  }

  /** The show on a second window (moved to another screen when the browser lets it), with the current slide, the next one, the notes and a clock here. */
  /** Another screen to show the slides on, when the browser lets us see the screens (Window Management). */
  private async otherScreen(): Promise<{ screen: unknown; w: number; h: number; dpr: number } | null> {
    try {
      const w = window as unknown as { getScreenDetails?: () => Promise<{ currentScreen: unknown; screens: { width: number; height: number; devicePixelRatio?: number }[] }> };
      const d = await w.getScreenDetails?.();
      const o = d?.screens.find((x) => x !== d.currentScreen);
      return o ? { screen: o, w: o.width, h: o.height, dpr: o.devicePixelRatio ?? 1 } : null;
    } catch {
      return null;
    }
  }

  private async presenterView(): Promise<void> {
    const session = this.session;
    if (!session) return;
    // on a second screen the slides go full screen there at once; with one screen, a window the person places
    const target = await this.otherScreen();
    let ext: HTMLElement | null = null;
    let win: Window | null = null;
    let showCanvas: HTMLCanvasElement;
    let showDoc: Document = document;
    let showBody: HTMLElement;
    if (target) {
      ext = el("div", "ot-px-show");
      ext.style.cssText = "left:-100000px;right:auto;width:100vw;height:100vh;cursor:none";
      showCanvas = el("canvas");
      ext.appendChild(showCanvas);
      document.body.appendChild(ext);
      try {
        await (ext as unknown as { requestFullscreen(o: unknown): Promise<void> }).requestFullscreen({ screen: target.screen });
      } catch {
        ext.remove();
        ext = null;
      }
    }
    if (!ext) {
      win = window.open("", "omnitext-slideshow", "popup=yes,width=1280,height=720");
      if (!win) return void this.host.notifications.error(t("pptxcraft.popupBlocked"));
      const wd = win.document;
      showDoc = wd;
      wd.title = t("pptxcraft.slideshow");
      wd.body.style.cssText = "margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden;font:16px system-ui,sans-serif;color:#aaa";
      showCanvas = wd.createElement("canvas");
      const hint = wd.createElement("div");
      hint.textContent = t("pptxcraft.clickFullscreen");
      hint.style.cssText = "position:fixed;bottom:12px;left:0;right:0;text-align:center;opacity:.7";
      wd.body.append(showCanvas, hint);
      wd.body.addEventListener("click", () => {
        hint.remove();
        void wd.documentElement.requestFullscreen?.().catch(() => undefined);
      });
      showBody = wd.body;
      try {
        const details = await (window as unknown as { getScreenDetails?: () => Promise<{ currentScreen: unknown; screens: { availLeft: number; availTop: number; availWidth: number; availHeight: number }[] }> }).getScreenDetails?.();
        const other = details?.screens.find((x) => x !== details.currentScreen);
        if (other) {
          win.moveTo(other.availLeft, other.availTop);
          win.resizeTo(other.availWidth, other.availHeight);
        }
      } catch {
        /* no permission or no such API: the person moves the window */
      }
    } else showBody = ext;
    const secondSize = (): { w: number; h: number } => (ext ? { w: ext.clientWidth || target!.w, h: ext.clientHeight || target!.h } : { w: win!.innerWidth || 1280, h: win!.innerHeight || 720 });
    const secondDpr = ext ? target!.dpr : this.dpr;
    const secondClosed = (): boolean => (win ? win.closed : false);

    const pv = el("div", "ot-pv");
    const main = el("div", "ot-pv-main");
    const mainCanvas = el("canvas");
    main.appendChild(mainCanvas);
    const side = el("div", "ot-pv-side");
    const nextWrap = el("div", "ot-pv-next");
    const nextCanvas = el("canvas");
    nextWrap.appendChild(nextCanvas);
    const notes = el("div", "ot-pv-notes");
    side.append(nextWrap, notes);
    const bar = el("div", "ot-pv-bar");
    const clock = el("span", "ot-pv-clock", "0:00");
    const counter = el("span");
    const prev = iconButton("up", t("pptxcraft.previous"), () => go(-1));
    const next = iconButton("down", t("pptxcraft.next"), () => go(1));
    const end = el("button", "btn", t("pptxcraft.endShow"));
    end.type = "button";
    bar.append(prev, next, counter, el("span", "grow"), clock, end);
    pv.append(main, side, bar);
    document.body.appendChild(pv);

    const total = this.ov.slides ?? 1;
    const started = Date.now();
    const tick = window.setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000);
      clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      if (secondClosed()) finish();
    }, 500);
    let unmount: (() => void) | null = null;
    let seq = 0;
    const runner: ShowRunner = new ShowRunner(
      await this.showHost(
        session,
        () => [
          { canvas: mainCanvas, size: () => ({ w: main.clientWidth, h: main.clientHeight }), dpr: this.dpr },
          { canvas: showCanvas, size: secondSize, dpr: secondDpr },
        ],
        {
          onLeave: () => {
            unmount?.();
            unmount = null;
          },
          onSlide: (shown) => {
            const mine = ++seq;
            counter.textContent = t("pptxcraft.slideOf", { n: shown + 1, total });
            prev.disabled = shown <= 0;
            next.disabled = shown >= total - 1;
            void this.drawTo(nextCanvas, shown + 1, nextWrap.clientWidth, nextWrap.clientHeight, this.dpr);
            const sb = showCanvas.getBoundingClientRect();
            const k = sb.width / this.slideW;
            void this.mountMedia(showBody, shown, (b) => ({ left: sb.left + b[0]! * k, top: sb.top + b[1]! * k, w: b[2]! * k, h: b[3]! * k }), { autoplay: true, doc: showDoc }).then((undo) => {
              if (mine !== seq) undo();
              else unmount = undo;
            });
            void this.enqueue(() => session.execute<{ notes?: string }>("slide.inspect", { index: shown })).then((info) => {
              if (mine !== seq) return;
              const text = typeof info?.notes === "string" ? info.notes.trim() : "";
              notes.textContent = text || t("pptxcraft.noNotes");
              notes.classList.toggle("none", !text);
            });
          },
        },
      ),
    );
    const go = (by: number): void => void (by > 0 ? runner.next() : runner.prev());
    const finish = (): void => {
      window.clearInterval(tick);
      runner.stop();
      unmount?.();
      document.removeEventListener("keydown", keys, true);
      win?.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
      window.removeEventListener("resize", onResize);
      pv.remove();
      if (win && !win.closed) win.close();
      if (ext) {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        ext.remove();
      }
      void this.cmd("slide.go", { index: runner.index });
    };
    const keys = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish();
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) go(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) go(-1);
      else if (e.key === "Home") void runner.goto(0);
      else if (e.key === "End") void runner.goto(total - 1, { built: true });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onResize = (): void => void runner.redraw();
    document.addEventListener("keydown", keys, true);
    win?.document.addEventListener("keydown", keys, true);
    win?.addEventListener("resize", onResize);
    win?.addEventListener("beforeunload", () => window.setTimeout(() => win!.closed && finish(), 0));
    if (ext) document.addEventListener("fullscreenchange", onResize);
    end.addEventListener("click", finish);
    window.addEventListener("resize", onResize);
    await runner.goto(this.ov.slide ?? 0);
  }

  private async customShow(): Promise<void> {
    const names = [...this.customShows.keys()];
    const v = await this.dialog(t("pptxcraft.customShow"), [
      { key: "play", label: t("pptxcraft.playExisting"), kind: "select", value: "", options: [["", t("pptxcraft.newShow")], ...names.map((n) => [n, n] as [string, string])] },
      { key: "name", label: t("pptxcraft.name"), kind: "text", value: "" },
      { key: "slides", label: t("pptxcraft.whichSlides"), kind: "text", value: "", placeholder: "1,3,5-7" },
    ]);
    if (!v) return;
    let order: number[] | undefined = this.customShows.get(String(v.play));
    if (!order) {
      order = [];
      for (const part of String(v.slides).split(",")) {
        const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
        if (!m) continue;
        for (let i = Number(m[1]); i <= Number(m[2] ?? m[1]); i++) order.push(i - 1);
      }
      const name = String(v.name).trim() || t("pptxcraft.customShow");
      if (!order.length) return;
      this.customShows.set(name, order);
      await this.cmd("show.customShow", { name, slides: order });
    }
    this.showOrder = order;
    try {
      await this.present(order[0]);
    } finally {
      this.showOrder = null;
    }
  }

  private async setupShow(): Promise<void> {
    const total = this.ov.slides ?? 1;
    const v = await this.dialog(t("pptxcraft.setupShow"), [
      { key: "loop", label: t("pptxcraft.loopShow"), kind: "check", value: this.showOpts.loop },
      { key: "noAnim", label: t("pptxcraft.noAnimation"), kind: "check", value: this.showOpts.noAnimation },
      { key: "from", label: t("pptxcraft.fromSlide"), kind: "number", value: this.showOpts.from + 1, min: 1, max: total },
      { key: "to", label: t("pptxcraft.toSlide"), kind: "number", value: (this.showOpts.to < 0 ? total : this.showOpts.to + 1), min: 1, max: total },
    ]);
    if (!v) return;
    this.showOpts = { loop: !!v.loop, noAnimation: !!v.noAnim, from: Math.max(0, Number(v.from) - 1), to: Number(v.to) >= total ? -1 : Number(v.to) - 1 };
    await this.cmd("show.setup", { loop: this.showOpts.loop, noAnimation: this.showOpts.noAnimation, from: this.showOpts.from, to: this.showOpts.to < 0 ? total - 1 : this.showOpts.to });
  }

  private async present(from?: number): Promise<void> {
    const session = this.session;
    if (!session) return;
    const show = el("div", "ot-px-show");
    show.tabIndex = 0;
    const canvas = el("canvas");
    show.appendChild(canvas);
    const closeBtn = el("button", "ot-px-close", "\u2715");
    closeBtn.type = "button";
    closeBtn.title = t("pptxcraft.endShow");
    closeBtn.setAttribute("aria-label", t("pptxcraft.endShow"));
    show.appendChild(closeBtn);
    document.body.appendChild(show);
    const total = this.ov.slides ?? 1;
    let unmount: (() => void) | null = null;
    const runner: ShowRunner = new ShowRunner(
      await this.showHost(session, () => [{ canvas, size: () => ({ w: window.innerWidth, h: window.innerHeight }), dpr: this.dpr }], {
        onLeave: () => {
          unmount?.();
          unmount = null;
        },
        onSlide: (shown) => mountHere(shown, true),
      }),
    );
    // the buttons over audio and video sit where the slide is drawn now, so they follow the window when it changes size
    const mountHere = (shown: number, autoplay: boolean): void => {
      const box = canvas.getBoundingClientRect();
      const k = box.width / this.slideW;
      void this.mountMedia(show, shown, (b) => ({ left: box.left + b[0]! * k, top: box.top + b[1]! * k, w: b[2]! * k, h: b[3]! * k }), { autoplay }).then((undo) => {
        if (runner.index !== shown || !show.isConnected) undo();
        else {
          unmount?.();
          unmount = undo;
        }
      });
    };
    const go = (by: number): void => void (by > 0 ? runner.next() : runner.prev());
    const end = (): void => {
      runner.stop();
      unmount?.();
      show.remove();
      document.removeEventListener("keydown", keys, true);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("fullscreenchange", onResize);
      window.removeEventListener("resize", onResize);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      void this.cmd("slide.go", { index: runner.index });
    };
    const onResize = (): void => {
      void runner.redraw().then(() => {
        unmount?.();
        unmount = null;
        mountHere(runner.index, false);
      });
    };
    // the system's back gesture leaves full screen, and with it the show
    let wasFull = false;
    const onFs = (): void => {
      if (document.fullscreenElement === show) wasFull = true;
      else if (wasFull && show.isConnected) end();
    };
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      end();
    });
    closeBtn.addEventListener("pointerup", (e) => e.stopPropagation());
    closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("fullscreenchange", onResize);
    const keys = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === "Escape") end();
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) go(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) go(-1);
      else if (e.key === "Home") void runner.goto(0);
      else if (e.key === "End") void runner.goto(total - 1, { built: true });
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", keys, true);
    window.addEventListener("resize", onResize);
    let downX = 0;
    show.addEventListener("pointerdown", (e) => {
      downX = e.clientX;
    });
    show.addEventListener("pointerup", (e) => {
      if ((e.target as HTMLElement).closest("[data-px-media]")) return;
      if (Math.abs(e.clientX - downX) > 60) return go(e.clientX < downX ? 1 : -1);
      const box = canvas.getBoundingClientRect();
      const k = this.slideW / box.width;
      const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      void (async () => {
        const pt = inside ? { x: (e.clientX - box.left) * k, y: (e.clientY - box.top) * k } : null;
        const hitId = pt ? ((await this.enqueue(() => session.hit(pt.x, pt.y, 2))) as { id?: number } | null)?.id : undefined;
        if (typeof hitId === "number" && runner.isTrigger(hitId)) return void runner.triggerClick(hitId);
        const act = pt ? await this.clickAction(session, runner.index, pt.x, pt.y) : null;
        if (act?.kind === "url" && act.url && /^(https?:|mailto:)/i.test(act.url)) window.open(act.url, "_blank", "noopener");
        else if (act?.kind === "slide" && act.slide !== undefined) void runner.goto(act.slide, { forward: true });
        else if (act?.kind === "next") go(1);
        else if (act?.kind === "previous") go(-1);
        else if (act?.kind === "first") void runner.goto(runner.first(), { forward: true });
        else if (act?.kind === "last") void runner.goto(total - 1, { forward: true });
        else if (act?.kind === "endShow") end();
        else {
          const r = show.getBoundingClientRect();
          go(e.clientX < r.left + r.width / 4 ? -1 : 1);
        }
      })();
    });
    show.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      end();
    });
    await show.requestFullscreen?.().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 350));
    await runner.goto(from === 0 ? runner.first() : (from ?? this.ov.slide ?? 0));
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
    this.editMedia?.();
    this.inspector.dispose();
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
