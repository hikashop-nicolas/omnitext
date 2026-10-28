import type { Overlay } from "craftbridge/deck";
import { t } from "../i18n";
import { formDialog } from "./pdfcraft-tools";
import { base64, colorMenu, el } from "./pptxcraft-ui";

// The side panel of the presentation editor: everything the floating bar has no room for, for the slide and for the selection.
// It reads the engine's own state (inspect commands) and sends the engine's own commands; nothing is kept here.

export interface InspectorHost {
  root: HTMLElement;
  run(id: string, params?: unknown, slides?: boolean): Promise<unknown>;
  query<T>(id: string, params?: unknown): Promise<T | undefined>;
  overlay(): Overlay;
  /** The shape whose points are being edited, if any, and the point last picked. */
  pointsEditing(): number | null;
  vertex(): { path: number; index: number } | null;
  setEditingPoints(on: boolean): Promise<void>;
}

interface Rgb {
  base?: { rgb?: { r: number; g: number; b: number } };
}
interface ShapeInfo {
  box?: { x: number; y: number; w: number; h: number };
  shape?: {
    locked?: boolean;
    descr?: string;
    kind?: { type?: string };
    line?: { width?: number; dash?: { name?: string }; fill?: { color?: Rgb }; head?: unknown; tail?: unknown } | null;
    fill?: { color?: Rgb } | null;
    effects?: { outerShadow?: unknown; glow?: unknown; softEdge?: unknown; reflection?: unknown } | null;
    text?: { body?: { anchor?: string | null; autofit?: { kind?: string } | null; wrap?: boolean | null; columns?: number | null; vert?: string | null; insetL?: number | null; insetT?: number | null; insetR?: number | null; insetB?: number | null } };
  };
}
interface SlideInfo {
  hidden?: boolean;
  layout?: string;
  background?: string;
  transition?: { kind?: string; option?: string; durationMs?: number | null; advanceOnClick?: boolean; advanceAfterMs?: number | null } | null;
  shapes?: { id: number; name: string; rotation?: number; kind?: string; chart?: { type?: string; title?: string; categories?: string[]; series?: { name: string; values: number[] }[] }; table?: { rows: number; cols: number } }[];
}
interface FormatState {
  align?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  bullets?: boolean;
  numbering?: boolean;
  font?: string;
  size?: number;
  lineSpacing?: number | null;
}
interface CommentInfo {
  author?: string;
  text?: string;
  resolved?: boolean;
  replies?: CommentInfo[];
}
interface MediaInfo {
  options?: { autoplay?: boolean; loop?: boolean; rewind?: boolean; hide?: boolean; fullScreen?: boolean; acrossSlides?: boolean; volume?: number; trimStart?: number; trimEnd?: number; fadeIn?: number; fadeOut?: number };
  durationMs?: number;
}
interface Anim {
  shape: number;
  effect: string;
  class: string;
  start: string;
  durationMs: number;
  delayMs: number;
}
interface Listed {
  id: string;
  label: string;
  class?: string;
  category?: string;
  options?: string[];
}

const hex = (c?: Rgb): string | null => {
  const v = c?.base?.rgb;
  return v ? `#${[v.r, v.g, v.b].map((n) => n.toString(16).padStart(2, "0")).join("")}` : null;
};

const ANIM_CLASS: Record<string, string> = { entr: "entrance", emph: "emphasis", exit: "exit", path: "path" };

const FONTS = ["Inter", "BIZ UDPGothic", "Arial", "Calibri", "Cambria", "Georgia", "Times New Roman", "Courier New", "Verdana", "Segoe UI", "Open Sans", "Roboto", "Lato", "Montserrat"];

export class Inspector {
  readonly el = el("div", "ot-px-insp");
  private body = el("div", "ot-px-insp-body");
  private token = 0;
  private timer = 0;
  private open = new Map<string, boolean>([["slide", true], ["shape", true], ["text", true]]);
  private transitions: Listed[] | null = null;
  private animations: Listed[] | null = null;
  private themes: { colorSchemes?: string[]; fontSchemes?: { name: string }[] } | null = null;
  private layouts: string[] | null = null;
  private pictureStyles: Listed[] | null = null;
  private recolors: Listed[] | null = null;

  constructor(private readonly h: InspectorHost) {
    this.el.append(this.body);
  }

  /** Asks for a redraw once things settle; the panel is built from the engine's state each time. */
  schedule(): void {
    if (this.el.hidden) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refresh(), 120);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.token++;
  }

  // ------------------------------------------------------------------ widgets

  private section(key: string, title: string): HTMLElement {
    const d = el("details", "ot-px-sec");
    d.open = this.open.get(key) ?? false;
    d.addEventListener("toggle", () => this.open.set(key, d.open));
    d.appendChild(el("summary", undefined, title));
    this.body.appendChild(d);
    return d;
  }

  private row(parent: HTMLElement, label: string, ...controls: HTMLElement[]): HTMLElement {
    const r = el("div", "ot-px-field");
    if (label) r.appendChild(el("label", undefined, label));
    const c = el("div", "ot-px-ctl");
    c.append(...controls);
    r.appendChild(c);
    parent.appendChild(r);
    return r;
  }

  private num(value: number | null | undefined, label: string, commit: (v: number) => void, o: { min?: number; max?: number; step?: number } = {}): HTMLInputElement {
    const i = el("input");
    i.type = "number";
    i.value = value === null || value === undefined || !Number.isFinite(value) ? "" : String(Math.round(value * 100) / 100);
    if (o.min !== undefined) i.min = String(o.min);
    if (o.max !== undefined) i.max = String(o.max);
    i.step = String(o.step ?? 1);
    i.setAttribute("aria-label", label);
    i.addEventListener("change", () => {
      const v = Number(i.value);
      if (i.value !== "" && Number.isFinite(v)) commit(v);
    });
    return i;
  }

  private select(options: [string, string][], value: string | undefined, label: string, commit: (v: string) => void): HTMLSelectElement {
    const s = el("select");
    s.setAttribute("aria-label", label);
    for (const [v, text] of options) {
      const o = el("option", undefined, text);
      o.value = v;
      s.appendChild(o);
    }
    if (value !== undefined && options.some(([v]) => v === value)) s.value = value;
    else if (value === undefined || value === "") s.selectedIndex = -1;
    s.addEventListener("change", () => commit(s.value));
    return s;
  }

  private check(label: string, on: boolean | undefined, commit: (v: boolean) => void): HTMLElement {
    const w = el("label", "ot-px-check");
    const i = el("input");
    i.type = "checkbox";
    i.checked = !!on;
    i.addEventListener("change", () => commit(i.checked));
    w.append(i, el("span", undefined, label));
    return w;
  }

  private button(label: string, run: () => void, o: { on?: boolean; title?: string } = {}): HTMLButtonElement {
    const b = el("button", `btn ot-px-sbtn${o.on ? " on" : ""}`, label);
    b.type = "button";
    if (o.title) b.title = o.title;
    b.addEventListener("click", run);
    return b;
  }

  private swatch(current: string | null, label: string, pick: (c: string | null) => void, none?: string): HTMLButtonElement {
    const b = el("button", "btn ot-px-sw");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.style.background = current ?? "transparent";
    b.addEventListener("click", () => colorMenu(this.h.root, b, { ...(none ? { none } : {}), custom: t("pptxcraft.custom") }, pick));
    return b;
  }

  private do(id: string, params?: unknown, slides = false): void {
    void this.h.run(id, params, slides);
  }

  // ------------------------------------------------------------------ building

  async refresh(): Promise<void> {
    const mine = ++this.token;
    const ov = this.h.overlay();
    if (!ov.open) return;
    const index = ov.slide ?? 0;
    const sel = ov.selection ?? [];
    const one = sel.length === 1 ? sel[0]!.id : null;
    const [slide, shape, state, anims] = await Promise.all([
      this.h.query<SlideInfo>("slide.inspect", { index }),
      one !== null ? this.h.query<ShapeInfo>("shape.inspect", { id: one }) : Promise.resolve(undefined),
      sel.length || ov.text ? this.h.query<FormatState>("format.state", {}) : Promise.resolve(undefined),
      this.h.query<Anim[]>("animation.get", { slide: index }),
    ]);
    this.transitions ??= (await this.h.query<Listed[]>("transition.list", {})) ?? [];
    this.animations ??= (await this.h.query<Listed[]>("animation.list", {})) ?? [];
    this.themes ??= (await this.h.query<{ colorSchemes?: string[]; fontSchemes?: { name: string }[] }>("design.themes", {})) ?? {};
    this.layouts ??= ((await this.h.query<{ layouts?: { name: string }[] }>("document.inspect", {}))?.layouts ?? []).map((l) => l.name);
    if (mine !== this.token) return;
    const scroll = this.el.scrollTop;
    this.body.replaceChildren();
    if (sel.length) this.shapeSection(sel.map((s) => s.id), shape, slide);
    const kind = shape?.shape?.kind?.type;
    const comments = (await this.h.query<CommentInfo[]>("comment.list", { slide: index })) ?? [];
    const sName = slide?.shapes?.find((x) => x.id === one)?.name ?? "";
    const media = kind === "media" && one !== null ? await this.h.query<MediaInfo>("media.info", { id: one }) : undefined;
    const nodes = kind === "group" && sName.startsWith("SmartArt") && one !== null ? await this.h.query<{ nodes?: { text: string; level: number }[] }>("smartArt.nodes", { id: one }) : undefined;
    if (kind === "table") this.tableSection(sel[0]!.id);
    if (kind === "picture") await this.pictureSection(sel[0]!.id);
    if (kind === "chart") this.chartSection(sel[0]!.id, slide);
    if (kind === "media" && media) this.mediaSection(sel[0]!.id, media);
    if (nodes) this.smartArtSection(sel[0]!.id, nodes.nodes ?? []);
    if (ov.text || (sel.length && !(kind === "picture" || kind === "chart" || kind === "media"))) this.textSection(state, shape);
    this.slideSection(slide, index);
    this.commentSection(comments, index);
    this.animationSection(slide, anims ?? [], sel.map((s) => s.id));
    this.designSection();
    this.el.scrollTop = scroll;
  }

  private shapeSection(ids: number[], info: ShapeInfo | undefined, slide: SlideInfo | undefined): void {
    const d = this.section("shape", t("pptxcraft.shape"));
    const kind1 = info?.shape?.kind?.type;
    const sh = info?.shape;
    const box = info?.box;
    if (ids.length === 1 && box) {
      const set = (k: "x" | "y" | "w" | "h") => (v: number) => this.do("shape.setBounds", { x: box.x, y: box.y, w: box.w, h: box.h, [k]: v });
      this.row(d, t("pptxcraft.position"), this.num(box.x, "X", set("x")), this.num(box.y, "Y", set("y")));
      this.row(d, t("pptxcraft.size"), this.num(box.w, t("pptxcraft.width"), set("w"), { min: 1 }), this.num(box.h, t("pptxcraft.height"), set("h"), { min: 1 }));
      const rot = slide?.shapes?.find((s) => s.id === ids[0])?.rotation ?? 0;
      this.row(d, t("pptxcraft.rotation"), this.num(rot, t("pptxcraft.rotation"), (v) => this.do("shape.rotate", { deg: v })));
      this.row(d, "", this.button(t("pptxcraft.flipH"), () => this.do("shape.flip", { axis: "horizontal" })), this.button(t("pptxcraft.flipV"), () => this.do("shape.flip", { axis: "vertical" })));
    }
    if (sh && sh.kind?.type === "shape") {
      const dash = sh.line?.dash?.name ?? "solid";
      this.row(d, t("pptxcraft.outline"), this.swatch(hex(sh.line?.fill?.color), t("pptxcraft.outline"), (c) => this.do("shape.line", c ? { color: c } : { none: true }), t("pptxcraft.noLine")),
        this.num(sh.line?.width ?? 0, t("pptxcraft.lineWidth"), (v) => this.do("shape.line", { width: v }), { min: 0, step: 0.5 }));
      this.row(d, t("pptxcraft.dash"), this.select([["solid", t("pptxcraft.dashSolid")], ["dot", t("pptxcraft.dashDot")], ["dash", t("pptxcraft.dashDash")], ["lgDash", t("pptxcraft.dashLong")], ["dashDot", t("pptxcraft.dashDashDot")]], dash, t("pptxcraft.dash"), (v) => this.do("shape.line", { dash: v })));
      this.row(d, t("pptxcraft.arrows"),
        this.select([["none", "—"], ["triangle", "▶"], ["stealth", "➤"], ["diamond", "◆"], ["oval", "●"], ["arrow", "→"]], "none", t("pptxcraft.arrowStart"), (v) => this.do("shape.line", { head: v })),
        this.select([["none", "—"], ["triangle", "▶"], ["stealth", "➤"], ["diamond", "◆"], ["oval", "●"], ["arrow", "→"]], "none", t("pptxcraft.arrowEnd"), (v) => this.do("shape.line", { tail: v })));
    }
    if (sh && ids.length === 1) {
      this.row(d, t("pptxcraft.shadow"), this.select([["none", t("pptxcraft.none")], ["outer", t("pptxcraft.shadowOuter")], ["inner", t("pptxcraft.shadowInner")], ["perspective", t("pptxcraft.shadowPerspective")]], sh.effects?.outerShadow ? "outer" : "none", t("pptxcraft.shadow"), (v) => this.do("shape.effects", { shadow: v })));
      this.row(d, t("pptxcraft.glow"), this.check(t("pptxcraft.on"), !!sh.effects?.glow, (on) => this.do("shape.effects", { glow: on ? { color: "#4a90d9", radius: 8 } : "none" })));
      this.row(d, t("pptxcraft.reflection"), this.select([["none", t("pptxcraft.none")], ["tight", t("pptxcraft.reflTight")], ["half", t("pptxcraft.reflHalf")], ["full", t("pptxcraft.reflFull")]], sh.effects?.reflection ? "half" : "none", t("pptxcraft.reflection"), (v) => this.do("shape.effects", { reflection: v })));
      this.row(d, t("pptxcraft.softEdges"), this.num(0, t("pptxcraft.softEdges"), (v) => this.do("shape.effects", { softEdges: v }), { min: 0 }));
      this.row(d, t("pptxcraft.altText"), (() => {
        const i = el("input");
        i.type = "text";
        i.value = sh.descr ?? "";
        i.setAttribute("aria-label", t("pptxcraft.altText"));
        i.addEventListener("change", () => this.do("shape.altText", { text: i.value }));
        return i;
      })());
      this.row(d, "", this.check(t("pptxcraft.locked"), sh.locked, (v) => this.do("shape.lock", { locked: v })));
      if (sh.kind?.type === "shape") {
        this.row(d, t("pptxcraft.changeShape"), this.select(SHAPES.map(([v, l]) => [v, t(`pptxcraft.${l}`)] as [string, string]), undefined, t("pptxcraft.changeShape"), (v) => this.do("shape.change", { preset: v })));
      }
    }
    const to = ids.length > 1 ? "selection" : "slide";
    const al = (edge: string, label: string) => this.button(label, () => this.do("arrange.align", { edge, to }), { title: label });
    this.row(d, t("pptxcraft.align"), al("left", "⇤"), al("center", "↔"), al("right", "⇥"), al("top", "⤒"), al("middle", "↕"), al("bottom", "⤓"));
    if (ids.length > 2) this.row(d, t("pptxcraft.distribute"), this.button("↔", () => this.do("arrange.distribute", { dir: "horizontal", to: "selection" })), this.button("↕", () => this.do("arrange.distribute", { dir: "vertical", to: "selection" })));
    this.row(d, t("pptxcraft.order"), this.button(t("pptxcraft.forward"), () => this.do("arrange.bringForward")), this.button(t("pptxcraft.backward"), () => this.do("arrange.sendBackward")));
    if (ids.length === 1 && kind1 !== "picture" && kind1 !== "chart" && kind1 !== "table" && kind1 !== "media") {
      const editing = this.h.pointsEditing() === ids[0];
      this.row(d, t("pptxcraft.points"), this.button(editing ? t("pptxcraft.done") : t("pptxcraft.editPoints"), () => void this.h.setEditingPoints(!editing).then(() => this.schedule()), { on: editing }));
      const v = this.h.vertex();
      if (editing && v) {
        const at = { path: v.path, index: v.index, id: ids[0] };
        this.row(d, "", this.button(t("pptxcraft.deletePoint"), () => this.do("shape.deletePoint", at)), this.button(t("pptxcraft.addPoint"), () => this.do("shape.addPoint", { path: v.path, segment: v.index, id: ids[0] })));
        this.row(d, t("pptxcraft.pointType"), this.select([["corner", t("pptxcraft.ptCorner")], ["smooth", t("pptxcraft.ptSmooth")], ["straight", t("pptxcraft.ptStraight")]], undefined, t("pptxcraft.pointType"), (x) => this.do("shape.pointType", { ...at, type: x })));
        this.row(d, t("pptxcraft.segment"), this.button(t("pptxcraft.segStraight"), () => this.do("shape.segmentType", { path: v.path, segment: v.index, type: "straight", id: ids[0] })), this.button(t("pptxcraft.segCurved"), () => this.do("shape.segmentType", { path: v.path, segment: v.index, type: "curved", id: ids[0] })));
      }
    }
    this.row(d, t("pptxcraft.formatPainter"), this.button(t("pptxcraft.copyFormat"), () => this.do("format.painter", {})), this.button(t("pptxcraft.pasteFormat"), () => this.do("format.painterApply", {})));
    if (ids.length > 1) this.row(d, t("pptxcraft.mergeShapes"), ...([["union", t("pptxcraft.mUnion")], ["combine", t("pptxcraft.mCombine")], ["fragment", t("pptxcraft.mFragment")], ["intersect", t("pptxcraft.mIntersect")], ["subtract", t("pptxcraft.mSubtract")]] as [string, string][]).map(([op, l]) => this.button(l, () => this.do("shape.merge", { op, ids }))));
    this.row(d, t("pptxcraft.action"), this.button(t("pptxcraft.linkAction"), () => void this.shapeAction(ids)));
    this.row(d, t("pptxcraft.group"), this.button(t("pptxcraft.groupDo"), () => this.do("arrange.group")), this.button(t("pptxcraft.ungroup"), () => this.do("arrange.ungroup")));
  }

  private textSection(state: FormatState | undefined, info: ShapeInfo | undefined): void {
    const d = this.section("text", t("pptxcraft.text"));
    const s = state ?? {};
    const body = info?.shape?.text?.body;
    const list = el("datalist");
    list.id = "ot-px-fonts";
    for (const f of FONTS) list.appendChild(Object.assign(el("option"), { value: f }));
    const fam = el("input");
    fam.type = "text";
    fam.setAttribute("list", "ot-px-fonts");
    fam.value = s.font ?? "";
    fam.setAttribute("aria-label", t("pptxcraft.font"));
    fam.addEventListener("change", () => fam.value.trim() && this.do("format.font", { family: fam.value.trim() }));
    this.row(d, t("pptxcraft.font"), fam, list);
    this.row(d, t("pptxcraft.fontSize"), this.num(s.size, t("pptxcraft.fontSize"), (v) => this.do("format.size", { size: v }), { min: 1, max: 999 }));
    const tog = (label: string, on: boolean | undefined, id: string, params?: unknown) => this.button(label, () => this.do(id, params), { on, title: label });
    this.row(d, "", tog("B", s.bold, "format.bold"), tog("I", s.italic, "format.italic"), tog("U", s.underline, "format.underline"), tog("S", s.strike, "format.strikethrough"), tog("x²", s.superscript, "format.superscript"), tog("x₂", s.subscript, "format.subscript"));
    this.row(d, t("pptxcraft.highlight"), this.swatch(null, t("pptxcraft.highlight"), (c) => this.do("format.highlight", c ? { color: c } : {}), t("pptxcraft.noFill")));
    this.row(d, t("pptxcraft.case"), this.select([["sentence", t("pptxcraft.caseSentence")], ["lower", t("pptxcraft.caseLower")], ["upper", t("pptxcraft.caseUpper")], ["title", t("pptxcraft.caseTitle")], ["toggle", t("pptxcraft.caseToggle")]], undefined, t("pptxcraft.case"), (v) => this.do("format.case", { mode: v })));
    this.row(d, t("pptxcraft.charSpacing"), this.select([["-3", t("pptxcraft.spVeryTight")], ["-1.5", t("pptxcraft.spTight")], ["0", t("pptxcraft.spNormal")], ["3", t("pptxcraft.spLoose")], ["6", t("pptxcraft.spVeryLoose")]], undefined, t("pptxcraft.charSpacing"), (v) => this.do("format.spacing", { pt: Number(v) })));
    const al = (a: string, glyph: string, title: string) => this.button(glyph, () => this.do("format.align", { align: a }), { on: s.align === a.charAt(0) || (a === "justify" && s.align === "just"), title });
    this.row(d, t("pptxcraft.paragraph"), al("left", "☰", t("pptxcraft.alignLeft")), al("center", "≡", t("pptxcraft.alignCenter")), al("right", "☷", t("pptxcraft.alignRight")), al("justify", "▤", t("pptxcraft.justify")));
    this.row(d, t("pptxcraft.lineSpacing"), this.select([["1", "1.0"], ["1.15", "1.15"], ["1.5", "1.5"], ["2", "2.0"], ["3", "3.0"]], s.lineSpacing ? String(s.lineSpacing) : undefined, t("pptxcraft.lineSpacing"), (v) => this.do("format.lineSpacing", { lines: Number(v) })));
    this.row(d, t("pptxcraft.spacing"), this.num(0, t("pptxcraft.spaceBefore"), (v) => this.do("format.paragraph", { spaceBefore: v }), { min: 0 }), this.num(0, t("pptxcraft.spaceAfter"), (v) => this.do("format.paragraph", { spaceAfter: v }), { min: 0 }));
    this.row(d, t("pptxcraft.indent"), this.num(0, t("pptxcraft.indentLeft"), (v) => this.do("format.paragraph", { indentLeft: v }), { min: 0 }), this.num(0, t("pptxcraft.indentFirst"), (v) => this.do("format.paragraph", { indentFirst: v })));
    this.row(d, "", this.button("•", () => this.do("format.bullets"), { on: s.bullets, title: t("pptxcraft.bullets") }), this.button("1.", () => this.do("format.numbering"), { on: s.numbering, title: t("pptxcraft.numbering") }),
      this.button("⇥", () => this.do("format.indent"), { title: t("pptxcraft.levelDown") }), this.button("⇤", () => this.do("format.outdent"), { title: t("pptxcraft.levelUp") }), this.button("⇄", () => this.do("format.rtl"), { title: t("pptxcraft.rtl") }));
    this.row(d, t("pptxcraft.anchor"), this.select([["top", t("pptxcraft.anchorTop")], ["middle", t("pptxcraft.anchorMiddle")], ["bottom", t("pptxcraft.anchorBottom")]], body?.anchor === "ctr" ? "middle" : body?.anchor === "b" ? "bottom" : "top", t("pptxcraft.anchor"), (v) => this.do("format.anchor", { anchor: v })));
    this.row(d, t("pptxcraft.autofit"), this.select([["none", t("pptxcraft.none")], ["shrink", t("pptxcraft.fitShrink")], ["resize", t("pptxcraft.fitResize")]], body?.autofit?.kind === "normal" ? "shrink" : body?.autofit?.kind === "shape" ? "resize" : "none", t("pptxcraft.autofit"), (v) => this.do("format.autofit", { mode: v })));
    this.row(d, "", this.check(t("pptxcraft.wrap"), body?.wrap !== false, (on) => this.do("format.wrap", { on })));
    this.row(d, t("pptxcraft.columns"), this.num(body?.columns ?? 1, t("pptxcraft.columns"), (v) => this.do("format.columns", { count: v }), { min: 1, max: 16 }));
    this.row(d, t("pptxcraft.direction"), this.select([["horizontal", t("pptxcraft.dirHorizontal")], ["rotate90", t("pptxcraft.dirRotate90")], ["rotate270", t("pptxcraft.dirRotate270")], ["stacked", t("pptxcraft.dirStacked")]], undefined, t("pptxcraft.direction"), (v) => this.do("format.direction", { dir: v })));
    const mg = (k: "left" | "top" | "right" | "bottom", v: number | null | undefined, label: string) => this.num(v === null || v === undefined ? undefined : v / 12700, label, (n) => this.do("format.margins", { [k]: n }), { min: 0, step: 1 });
    this.row(d, t("pptxcraft.margins"), mg("left", body?.insetL, t("pptxcraft.marginLeft")), mg("top", body?.insetT, t("pptxcraft.marginTop")), mg("right", body?.insetR, t("pptxcraft.marginRight")), mg("bottom", body?.insetB, t("pptxcraft.marginBottom")));
  }

  private tableSection(id: number): void {
    const d = this.section("table", t("pptxcraft.tableTools"));
    const tb = (label: string, cmd: string) => this.button(label, () => this.do(cmd, { id }), { title: label });
    this.row(d, t("pptxcraft.rows"), tb("＋↑", "table.insertRowAbove"), tb("＋↓", "table.insertRowBelow"), tb("－", "table.deleteRow"));
    this.row(d, t("pptxcraft.columns"), tb("＋←", "table.insertColumnLeft"), tb("＋→", "table.insertColumnRight"), tb("－", "table.deleteColumn"));
    this.row(d, t("pptxcraft.cells"), this.button(t("pptxcraft.merge"), () => void this.mergeCells(id)), this.button(t("pptxcraft.split"), () => this.do("table.split", { id })));
    this.row(d, t("pptxcraft.tableStyle"), this.select([["medium2-accent1", t("pptxcraft.tsMedium")], ["light1-accent1", t("pptxcraft.tsLight")], ["dark1-tx1", t("pptxcraft.tsDark")], ["grid", t("pptxcraft.tsGrid")], ["none", t("pptxcraft.none")]], undefined, t("pptxcraft.tableStyle"), (v) => this.do("table.style", { style: v, id })));
    const opt = (key: string, label: string, on = true) => this.check(label, on, (v) => this.do("table.options", { [key]: v, id }));
    this.row(d, "", opt("headerRow", t("pptxcraft.headerRow")), opt("bandedRows", t("pptxcraft.bandedRows")));
    this.row(d, "", opt("firstColumn", t("pptxcraft.firstColumn"), false), opt("totalRow", t("pptxcraft.totalRow"), false));
    this.row(d, t("pptxcraft.shading"), this.swatch(null, t("pptxcraft.shading"), (c) => this.do("table.cellFill", c ? { color: c, id } : { none: true, id }), t("pptxcraft.noFill")));
    this.row(d, t("pptxcraft.borders"), this.select([["all", t("pptxcraft.bAll")], ["outside", t("pptxcraft.bOutside")], ["inside", t("pptxcraft.bInside")], ["none", t("pptxcraft.none")]], undefined, t("pptxcraft.borders"), (v) => this.do("table.borders", { which: v, color: "#404040", width: 1, id })));
    this.row(d, t("pptxcraft.anchor"), this.select([["top", t("pptxcraft.anchorTop")], ["middle", t("pptxcraft.anchorMiddle")], ["bottom", t("pptxcraft.anchorBottom")]], undefined, t("pptxcraft.anchor"), (v) => this.do("table.cellAlign", { anchor: v, id })));
    this.row(d, t("pptxcraft.distribute"), tb(t("pptxcraft.rows"), "table.distributeRows"), tb(t("pptxcraft.columns"), "table.distributeColumns"));
  }

  private async shapeAction(ids: number[]): Promise<void> {
    const v = await formDialog(this.h.root, {
      title: t("pptxcraft.linkAction"),
      ok: t("pptxcraft.ok"),
      cancel: t("pptxcraft.cancel"),
      fields: [
        { key: "action", label: t("pptxcraft.action"), kind: "select", value: "url", options: [["none", t("pptxcraft.none")], ["url", t("pptxcraft.actWebsite")], ["slide", t("pptxcraft.actSlide")], ["next", t("pptxcraft.actNext")], ["previous", t("pptxcraft.actPrevious")], ["first", t("pptxcraft.actFirst")], ["last", t("pptxcraft.actLast")], ["endShow", t("pptxcraft.actEnd")], ["playMedia", t("pptxcraft.actPlay")]] },
        { key: "url", label: t("pptxcraft.address"), kind: "text", value: "https://" },
        { key: "slide", label: t("pptxcraft.slideNo"), kind: "number", value: 1, min: 1 },
      ],
    });
    if (!v) return;
    const action = String(v.action);
    this.do("shape.action", { on: "click", action, ids, ...(action === "url" ? { url: String(v.url) } : {}), ...(action === "slide" ? { slide: Number(v.slide) - 1 } : {}) });
  }

  private async mergeCells(id: number): Promise<void> {
    const v = await formDialog(this.h.root, {
      title: t("pptxcraft.merge"),
      ok: t("pptxcraft.ok"),
      cancel: t("pptxcraft.cancel"),
      fields: [
        { key: "r1", label: t("pptxcraft.fromRow"), kind: "number", value: 1, min: 1 },
        { key: "c1", label: t("pptxcraft.fromCol"), kind: "number", value: 1, min: 1 },
        { key: "r2", label: t("pptxcraft.toRow"), kind: "number", value: 1, min: 1 },
        { key: "c2", label: t("pptxcraft.toCol"), kind: "number", value: 2, min: 1 },
      ],
    });
    if (!v) return;
    this.do("table.merge", { from: [Number(v.r1) - 1, Number(v.c1) - 1], to: [Number(v.r2) - 1, Number(v.c2) - 1], id });
  }

  private async pictureSection(id: number): Promise<void> {
    this.pictureStyles ??= (await this.h.query<Listed[]>("picture.styles", {})) ?? [];
    this.recolors ??= (await this.h.query<Listed[]>("picture.recolors", {})) ?? [];
    const d = this.section("picture", t("pptxcraft.pictureTools"));
    const frac = (k: string, label: string) => this.num(0, label, (v) => this.do("picture.crop", { [k]: Math.min(0.95, Math.max(0, v / 100)), ids: [id] }), { min: 0, max: 95 });
    this.row(d, t("pptxcraft.crop"), frac("left", t("pptxcraft.marginLeft")), frac("top", t("pptxcraft.marginTop")), frac("right", t("pptxcraft.marginRight")), frac("bottom", t("pptxcraft.marginBottom")));
    const adj = (k: string, label: string, min: number, max: number) => this.num(0, label, (v) => this.do("picture.adjust", { [k]: v, ids: [id] }), { min, max, step: 0.1 });
    this.row(d, t("pptxcraft.brightness"), adj("brightness", t("pptxcraft.brightness"), -1, 1));
    this.row(d, t("pptxcraft.contrast"), adj("contrast", t("pptxcraft.contrast"), -1, 1));
    this.row(d, t("pptxcraft.saturation"), adj("saturation", t("pptxcraft.saturation"), 0, 4));
    this.row(d, t("pptxcraft.transparency"), adj("transparency", t("pptxcraft.transparency"), 0, 1));
    this.row(d, t("pptxcraft.style"), this.select((this.pictureStyles ?? []).map((x) => [x.id, x.label] as [string, string]), undefined, t("pptxcraft.style"), (v) => this.do("picture.style", { style: v, ids: [id] })));
    this.row(d, t("pptxcraft.recolor"), this.select((this.recolors ?? []).map((x) => [x.id, x.label] as [string, string]), undefined, t("pptxcraft.recolor"), (v) => this.do("picture.recolor", { preset: v, ids: [id] })));
    this.row(d, t("pptxcraft.effect"), this.select([["none", t("pptxcraft.none")], ["artisticBlur", t("pptxcraft.efBlur")], ["artisticPencilGrayscale", t("pptxcraft.efPencil")], ["artisticLineDrawing", t("pptxcraft.efLine")], ["artisticFilmGrain", t("pptxcraft.efGrain")], ["artisticGlowEdges", t("pptxcraft.efGlow")]], undefined, t("pptxcraft.effect"), (v) => this.do("picture.artisticEffect", { effect: v, ids: [id] })));
    const file = el("input");
    file.type = "file";
    file.accept = "image/*";
    file.hidden = true;
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (f) void f.arrayBuffer().then((b) => this.do("picture.change", { data: base64(new Uint8Array(b)), name: f.name, ids: [id] }));
    });
    this.row(d, "", this.button(t("pptxcraft.removeBackground"), () => this.do("picture.removeBackground", { ids: [id] })), this.button(t("pptxcraft.changePicture"), () => file.click()), this.button(t("pptxcraft.reset"), () => this.do("picture.reset", { ids: [id] })), this.button(t("pptxcraft.compress"), () => this.do("picture.compress", { all: true })), file);
  }

  private chartSection(id: number, slide: SlideInfo | undefined): void {
    const d = this.section("chart", t("pptxcraft.chartTools"));
    const ch = slide?.shapes?.find((s) => s.id === id)?.chart;
    const types: [string, string][] = [["column", t("pptxcraft.chColumn")], ["bar", t("pptxcraft.chBar")], ["line", t("pptxcraft.chLine")], ["pie", t("pptxcraft.chPie")], ["doughnut", t("pptxcraft.chDoughnut")], ["area", t("pptxcraft.chArea")], ["scatter", t("pptxcraft.chScatter")]];
    this.row(d, t("pptxcraft.chartType"), this.select(types, undefined, t("pptxcraft.chartType"), (v) => this.do("chart.type", { type: v, id })));
    const title = el("input");
    title.type = "text";
    title.value = ch?.title ?? "";
    title.setAttribute("aria-label", t("pptxcraft.chartTitle"));
    title.addEventListener("change", () => this.do("chart.options", { title: title.value || null, id }));
    this.row(d, t("pptxcraft.chartTitle"), title);
    this.row(d, t("pptxcraft.legend"), this.select([["", t("pptxcraft.none")], ["b", t("pptxcraft.anchorBottom")], ["t", t("pptxcraft.anchorTop")], ["l", t("pptxcraft.marginLeft")], ["r", t("pptxcraft.marginRight")]], undefined, t("pptxcraft.legend"), (v) => this.do("chart.options", { legend: v || null, id })));
    this.row(d, "", this.check(t("pptxcraft.dataLabels"), false, (v) => this.do("chart.options", { dataLabels: v, id })), this.check(t("pptxcraft.gridlines"), true, (v) => this.do("chart.options", { gridlines: v, id })));
    this.row(d, "", this.button(t("pptxcraft.editData"), () => void this.editChartData(id, ch)));
  }

  /** The chart's numbers as a tab-separated grid: the first row names the series, the first column the categories. */
  private async editChartData(id: number, ch: { categories?: string[]; series?: { name: string; values: number[] }[] } | undefined): Promise<void> {
    const cats = ch?.categories ?? [];
    const series = ch?.series ?? [];
    const lines = [["", ...series.map((s) => s.name)].join("\t")];
    cats.forEach((c, i) => lines.push([c, ...series.map((s) => String(s.values[i] ?? ""))].join("\t")));
    const v = await formDialog(this.h.root, { title: t("pptxcraft.editData"), ok: t("pptxcraft.ok"), cancel: t("pptxcraft.cancel"), note: t("pptxcraft.dataHint"), fields: [{ key: "grid", label: t("pptxcraft.data"), kind: "textarea", value: lines.join("\n") }] });
    if (!v) return;
    const rows = String(v.grid).split(/\r?\n/).filter((r) => r.trim() !== "").map((r) => r.split("\t"));
    if (rows.length < 2) return;
    const names = rows[0]!.slice(1);
    const body = rows.slice(1);
    this.do("chart.data", { categories: body.map((r) => r[0] ?? ""), series: names.map((name, i) => ({ name, values: body.map((r) => Number(r[i + 1]) || 0) })), id });
  }

  private mediaSection(id: number, m: MediaInfo): void {
    const d = this.section("media", t("pptxcraft.mediaTools"));
    const o = m.options ?? {};
    const opt = (key: string, label: string, on: boolean | undefined) => this.check(label, on, (v) => this.do("media.options", { [key]: v, ids: [id] }));
    this.row(d, "", opt("autoplay", t("pptxcraft.autoplay"), o.autoplay), opt("loop", t("pptxcraft.loop"), o.loop));
    this.row(d, "", opt("rewind", t("pptxcraft.rewind"), o.rewind), opt("hide", t("pptxcraft.hideUnplayed"), o.hide));
    this.row(d, "", opt("fullScreen", t("pptxcraft.fullScreen"), o.fullScreen), opt("acrossSlides", t("pptxcraft.acrossSlides"), o.acrossSlides));
    this.row(d, t("pptxcraft.volume"), this.num((o.volume ?? 1) * 100, t("pptxcraft.volume"), (v) => this.do("media.options", { volume: Math.min(1, Math.max(0, v / 100)), ids: [id] }), { min: 0, max: 100, step: 5 }));
    const sec = (key: string, label: string, ms: number | undefined) => this.num((ms ?? 0) / 1000, label, (v) => this.do("media.options", { [key]: Math.round(Math.max(0, v) * 1000), ids: [id] }), { min: 0, step: 0.1 });
    this.row(d, t("pptxcraft.trim"), sec("trimStart", t("pptxcraft.trimStart"), o.trimStart), sec("trimEnd", t("pptxcraft.trimEnd"), o.trimEnd));
    this.row(d, t("pptxcraft.fade"), sec("fadeIn", t("pptxcraft.fadeIn"), o.fadeIn), sec("fadeOut", t("pptxcraft.fadeOut"), o.fadeOut));
  }

  private smartArtSection(id: number, nodes: { text: string; level: number }[]): void {
    const d = this.section("smartart", t("pptxcraft.smartArt"));
    const ta = el("textarea");
    ta.rows = 5;
    ta.value = nodes.map((n) => `${"\t".repeat(n.level)}${n.text}`).join("\n");
    ta.setAttribute("aria-label", t("pptxcraft.items"));
    ta.addEventListener("change", () => this.do("smartArt.setNodes", { id, lines: ta.value.split(/\r?\n/).filter((l) => l.trim() !== "") }));
    this.row(d, t("pptxcraft.items"), ta);
    const kinds: [string, string][] = [["list", t("pptxcraft.saList")], ["process", t("pptxcraft.saProcess")], ["cycle", t("pptxcraft.saCycle")], ["hierarchy", t("pptxcraft.saHierarchy")], ["pyramid", t("pptxcraft.saPyramid")], ["matrix", t("pptxcraft.saMatrix")], ["chevron", "Chevron"], ["radial", "Radial"], ["venn", "Venn"], ["funnel", "Funnel"], ["timeline", "Timeline"], ["orgChart", "Org chart"]];
    this.row(d, t("pptxcraft.layout"), this.select(kinds, undefined, t("pptxcraft.layout"), (v) => this.do("smartArt.layout", { id, kind: v })));
    this.row(d, t("pptxcraft.style"), this.select(["flat", "subtle", "intense", "outline", "polished", "inset", "cartoon", "powder", "brick"].map((x) => [x, x] as [string, string]), undefined, t("pptxcraft.style"), (v) => this.do("smartArt.style", { id, style: v })));
    this.row(d, t("pptxcraft.palette"), this.select(["colorful", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map((x) => [x, x] as [string, string]), undefined, t("pptxcraft.palette"), (v) => this.do("smartArt.colors", { id, colors: v })));
    this.row(d, "", this.button(t("pptxcraft.addItem"), () => this.do("smartArt.addNode", { id })));
  }

  private commentSection(list: CommentInfo[], index: number): void {
    const d = this.section("comments", `${t("pptxcraft.comments")} (${list.length})`);
    list.forEach((c, i) => {
      const box = el("div", "ot-px-comment");
      box.appendChild(el("b", undefined, c.author ?? ""));
      box.appendChild(el("p", c.resolved ? "done" : undefined, c.text ?? ""));
      for (const r of c.replies ?? []) box.appendChild(el("p", "reply", `↳ ${r.author ?? ""}: ${r.text ?? ""}`));
      const bar = el("div", "ot-px-ctl");
      bar.append(
        this.button(t("pptxcraft.reply"), () => void this.replyTo(i, index)),
        this.button(c.resolved ? t("pptxcraft.reopen") : t("pptxcraft.resolve"), () => this.do("comment.resolve", { index: i, resolved: !c.resolved, slide: index })),
        this.button(t("pptxcraft.delete"), () => this.do("comment.delete", { index: i, slide: index })),
      );
      box.appendChild(bar);
      d.appendChild(box);
    });
    this.row(d, "", this.button(t("pptxcraft.addComment"), () => void this.newComment()));
  }

  private async replyTo(i: number, slide: number): Promise<void> {
    const v = await formDialog(this.h.root, { title: t("pptxcraft.reply"), ok: t("pptxcraft.ok"), cancel: t("pptxcraft.cancel"), fields: [{ key: "text", label: t("pptxcraft.comment"), kind: "textarea", value: "" }] });
    if (v && String(v.text).trim()) this.do("comment.reply", { index: i, text: String(v.text).trim(), slide });
  }

  private async newComment(): Promise<void> {
    const v = await formDialog(this.h.root, { title: t("pptxcraft.addComment"), ok: t("pptxcraft.ok"), cancel: t("pptxcraft.cancel"), fields: [{ key: "text", label: t("pptxcraft.comment"), kind: "textarea", value: "" }] });
    if (v && String(v.text).trim()) this.do("comment.add", { text: String(v.text).trim() });
  }

  private slideSection(slide: SlideInfo | undefined, index: number): void {
    const d = this.section("slide", t("pptxcraft.slideTitle", { n: index + 1 }));
    const layouts = this.layouts ?? [];
    this.row(d, t("pptxcraft.layout"), this.select(layouts.map((l) => [l, l] as [string, string]), slide?.layout, t("pptxcraft.layout"), (v) => this.do("slide.layout", { layout: v }, true)));
    this.row(d, t("pptxcraft.background"), this.swatch(slide?.background ?? null, t("pptxcraft.background"), (c) => c && this.do("design.background", { color: c })),
      this.button(t("pptxcraft.applyAll"), () => slide?.background && this.do("design.background", { color: slide.background, all: true }), { title: t("pptxcraft.applyAllBackground") }),
      this.button(t("pptxcraft.reset"), () => this.do("design.background", { reset: true })));
    this.row(d, "", this.check(t("pptxcraft.hideSlide"), slide?.hidden, (v) => this.do("slide.hide", { hidden: v, index }, true)), this.button(t("pptxcraft.resetSlide"), () => this.do("slide.reset", { index })));
    const tr = slide?.transition;
    const kinds = (this.transitions ?? []).map((x) => [x.id, x.label] as [string, string]);
    this.row(d, t("pptxcraft.transition"), this.select(kinds, tr?.kind ?? "none", t("pptxcraft.transition"), (v) => this.do("transition.set", { kind: v, index })));
    const cur = (this.transitions ?? []).find((x) => x.id === (tr?.kind ?? "none"));
    if (cur?.options?.length) this.row(d, t("pptxcraft.effectOption"), this.select(cur.options.map((o) => [o, o] as [string, string]), tr?.option, t("pptxcraft.effectOption"), (v) => this.do("transition.options", { option: v, index })));
    if (tr && tr.kind !== "none") {
      this.row(d, t("pptxcraft.duration"), this.num((tr.durationMs ?? 0) / 1000, t("pptxcraft.duration"), (v) => this.do("transition.timing", { duration: Math.round(v * 1000), index }), { min: 0, step: 0.1 }));
      this.row(d, "", this.check(t("pptxcraft.onClick"), tr.advanceOnClick !== false, (v) => this.do("transition.timing", { onClick: v, index })));
      this.row(d, t("pptxcraft.after"), this.num(tr.advanceAfterMs === null || tr.advanceAfterMs === undefined ? null : tr.advanceAfterMs / 1000, t("pptxcraft.after"), (v) => this.do("transition.timing", { after: v > 0 ? Math.round(v * 1000) : null, index }), { min: 0, step: 0.5 }));
      this.row(d, "", this.button(t("pptxcraft.applyAllSlides"), () => this.do("transition.applyAll", {})));
    }
  }

  private animationSection(slide: SlideInfo | undefined, anims: Anim[], ids: number[]): void {
    const d = this.section("anim", t("pptxcraft.animations"));
    const name = (id: number) => slide?.shapes?.find((s) => s.id === id)?.name ?? `#${id}`;
    anims.forEach((a, i) => {
      const line = el("div", "ot-px-anim");
      line.appendChild(el("span", undefined, `${i + 1}. ${a.effect} · ${name(a.shape)}`));
      const sel = this.select([["onClick", t("pptxcraft.startClick")], ["withPrevious", t("pptxcraft.startWith")], ["afterPrevious", t("pptxcraft.startAfter")]], a.start, t("pptxcraft.start"), (v) => this.do("animation.timing", { index: i, start: v }));
      line.append(sel, this.button("↑", () => this.do("animation.move", { index: i, to: Math.max(0, i - 1) }), { title: t("pptxcraft.moveUp") }), this.button("↓", () => this.do("animation.move", { index: i, to: Math.min(anims.length - 1, i + 1) }), { title: t("pptxcraft.moveDown") }), this.button("✕", () => this.do("animation.remove", { index: i }), { title: t("pptxcraft.delete") }));
      d.appendChild(line);
    });
    if (!ids.length) {
      d.appendChild(el("p", "ot-px-hint", t("pptxcraft.animHint")));
      return;
    }
    const list = this.animations ?? [];
    const pick = this.select(list.map((x) => [`${x.class}:${x.id}`, `${x.label}`] as [string, string]), list[0] ? `${list[0].class}:${list[0].id}` : undefined, t("pptxcraft.effect"), () => undefined);
    const start = this.select([["onClick", t("pptxcraft.startClick")], ["withPrevious", t("pptxcraft.startWith")], ["afterPrevious", t("pptxcraft.startAfter")]], "onClick", t("pptxcraft.start"), () => undefined);
    this.row(d, t("pptxcraft.effect"), pick);
    this.row(d, t("pptxcraft.start"), start);
    this.row(d, "", this.button(t("pptxcraft.addAnimation"), () => {
      const [cls, effect] = pick.value.split(":");
      if (!effect) return;
      this.do("animation.add", { effect, class: ANIM_CLASS[cls ?? ""] ?? "entrance", start: start.value, ids });
    }));
  }

  private async designIdeas(): Promise<void> {
    const ideas = (await this.h.query<{ id: string; label: string }[]>("design.ideas", {})) ?? [];
    if (!ideas.length) {
      await formDialog(this.h.root, { title: t("pptxcraft.designIdeas"), ok: t("pptxcraft.ok"), cancel: t("pptxcraft.cancel"), note: t("pptxcraft.noIdeas"), fields: [] });
      return;
    }
    const v = await formDialog(this.h.root, { title: t("pptxcraft.designIdeas"), ok: t("pptxcraft.ok"), cancel: t("pptxcraft.cancel"), fields: [{ key: "id", label: t("pptxcraft.designIdeas"), kind: "select", value: ideas[0]!.id, options: ideas.map((i) => [i.id, i.label] as [string, string]) }] });
    if (v) this.do("design.applyIdea", { id: String(v.id) }, true);
  }

  private designSection(): void {
    const d = this.section("design", t("pptxcraft.design"));
    const th = this.themes ?? {};
    if (th.colorSchemes?.length) this.row(d, t("pptxcraft.themeColors"), this.select(th.colorSchemes.map((n) => [n, n] as [string, string]), undefined, t("pptxcraft.themeColors"), (v) => this.do("design.colors", { name: v })));
    if (th.fontSchemes?.length) this.row(d, t("pptxcraft.themeFonts"), this.select(th.fontSchemes.map((n) => [n.name, n.name] as [string, string]), undefined, t("pptxcraft.themeFonts"), (v) => this.do("design.fonts", { name: v })));
    this.row(d, "", this.button(t("pptxcraft.designIdeas"), () => void this.designIdeas()));
    this.row(d, t("pptxcraft.variants"), ...[0, 1, 2, 3].map((i) => this.button(String(i + 1), () => this.do("design.variant", { index: i }))));
    this.row(d, t("pptxcraft.slideSize"), this.select([["widescreen", t("pptxcraft.sizeWide")], ["standard", t("pptxcraft.sizeStandard")]], undefined, t("pptxcraft.slideSize"), (v) => this.do("design.slideSize", { preset: v, scale: "ensureFit" })));
    this.row(d, "", this.check(t("pptxcraft.slideNumber"), undefined, (v) => this.do("design.headerFooter", { slideNumber: v })), this.check(t("pptxcraft.footer"), undefined, (v) => this.do("design.headerFooter", { footer: v })), this.check(t("pptxcraft.date"), undefined, (v) => this.do("design.headerFooter", { date: v })));
  }
}

const SHAPES: [string, string][] = [
  ["rect", "shapeRect"],
  ["roundRect", "shapeRound"],
  ["ellipse", "shapeEllipse"],
  ["triangle", "shapeTriangle"],
  ["diamond", "shapeDiamond"],
  ["rightArrow", "shapeArrow"],
  ["star5", "shapeStar"],
];
