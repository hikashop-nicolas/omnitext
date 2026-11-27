import type { CallTree, Frame } from "./profile-model";

// Canvas flame graph: the call tree with each frame as wide as its total. Top-down trees grow
// up from the root at the bottom; inverted ones (callers of each function) hang down as an
// icicle. Only frames wider than half a pixel are visited, so huge trees stay quick.

export interface FlameText {
  aria: string;
  /** The synthetic root's label ("all"). */
  all: string;
  /** Hover and focus text for a node. */
  describe: (node: number) => string;
}

const ROW = 18;
const PAD = 4;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const isDark = (): boolean => {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
};

// Fixed hues for the usual categories, so a language keeps its colour from file to file.
const CATEGORY_HUES: Record<string, [number, number]> = {
  Kernel: [18, 75],
  Native: [42, 70],
  User: [30, 75],
  Java: [130, 45],
  DEX: [130, 45],
  OAT: [140, 45],
  JIT: [160, 50],
  JavaScript: [52, 85],
  Python: [210, 55],
  Go: [190, 60],
  ".NET": [270, 45],
  Ruby: [350, 55],
  PHP: [235, 40],
  GC: [200, 25],
  Idle: [0, 0],
  Other: [0, 0],
  Inlined: [175, 45],
  Layout: [280, 50],
  Graphics: [100, 50],
  DOM: [220, 60],
  Network: [195, 70],
};

/** A frame's colour for one colouring mode, in this theme. */
export function frameColor(f: Frame, mode: "module" | "category", dark: boolean): string {
  // Each function shifts its group's colour a little, so neighbours stay apart.
  const n = hash(f.name);
  const light = (dark ? 38 : 70) + ((n % 9) - 4);
  const shift = ((n >> 8) % 11) - 5;
  if (mode === "category") {
    const fixed = CATEGORY_HUES[f.category];
    if (fixed) return fixed[1] ? `hsl(${fixed[0] + shift} ${fixed[1]}% ${light}%)` : `hsl(0 0% ${light + (dark ? -4 : 8)}%)`;
    if (!f.category) return `hsl(0 0% ${light + (dark ? -4 : 8)}%)`;
    return `hsl(${(hash(f.category) % 360) + shift} 50% ${light}%)`;
  }
  const h = hash(f.module || f.category || "");
  return `hsl(${((h % 360) + shift * 2 + 360) % 360} ${45 + ((h >> 9) % 25)}% ${light}%)`;
}

export class FlameGraph {
  readonly root: HTMLElement;
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tip: HTMLElement;
  private tree: CallTree | null = null;
  private frames: Frame[] = [];
  private colors: string[] = [];
  private mode: "module" | "category" = "module";
  private match: Uint8Array | null = null;
  /** The visible range, in value units along the root's width. */
  private v0 = 0;
  private v1 = 1;
  private zoomNode = 0;
  private history: number[] = [];
  private focusNode = -1;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private resize: ResizeObserver | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: boolean; v0: number; v1: number; top: number; vertical?: boolean } | null = null;
  private charW = 6.5;
  /** Called after the visible range changes. */
  onView: (() => void) | null = null;
  /** Called when the focused or hovered node changes (-1: none); `announce` for keyboard and taps. */
  onFocus: ((node: number, announce: boolean) => void) | null = null;
  /** Called when a frame is picked (click, tap, Enter), after zooming to it. */
  onPick: ((node: number) => void) | null = null;

  constructor(
    host: HTMLElement,
    private text: FlameText,
  ) {
    this.root = document.createElement("div");
    this.root.className = "ot-fg";
    this.scroller = document.createElement("div");
    this.scroller.className = "ot-fg-scroll";
    this.spacer = document.createElement("div");
    this.spacer.className = "ot-fg-spacer";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "ot-fg-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-label", text.aria);
    this.tip = document.createElement("div");
    this.tip.className = "ot-fg-tip";
    this.tip.hidden = true;
    this.spacer.append(this.canvas);
    this.scroller.append(this.spacer);
    this.root.append(this.scroller, this.tip);
    host.append(this.root);
    this.ctx = this.canvas.getContext("2d")!;
    this.bind();
  }

  // --- public ---------------------------------------------------------------------------

  setTree(tree: CallTree, frames: Frame[], keepZoom = false): void {
    const prevFrame = keepZoom && this.tree ? this.pathOf(this.zoomNode) : null;
    const wasInverted = this.tree?.inverted;
    this.tree = tree;
    this.frames = frames;
    this.history = [];
    this.focusNode = -1;
    this.recolor();
    this.spacer.style.height = `${this.contentH()}px`;
    // Keep zoomed on the same call path when the samples change (a thread or time range).
    const again = prevFrame ? this.nodeAt(prevFrame) : -1;
    this.zoomTo(again > 0 ? again : 0, false);
    if (wasInverted !== tree.inverted || !keepZoom) {
      // A flame graph starts scrolled to its root, at the bottom.
      requestAnimationFrame(() => {
        this.scroller.scrollTop = tree.inverted ? 0 : this.scroller.scrollHeight;
        this.redraw();
      });
    }
  }

  setColorMode(mode: "module" | "category"): void {
    this.mode = mode;
    this.recolor();
    this.redraw();
  }

  /** Frames to highlight (search matches), or null for none. */
  setMatches(match: Uint8Array | null): void {
    this.match = match;
    this.redraw();
  }

  zoomLevel(): number {
    const total = this.tree?.total[0] ?? 0;
    return total > 0 ? total / Math.max(this.v1 - this.v0, 1e-300) : 1;
  }

  maxZoom(): number {
    const total = this.tree?.total[0] ?? 0;
    return Math.max(16, Math.min(1e6, total > 0 ? (total / this.smallest()) * 4 : 16));
  }

  /** Zoom to a level, around the view's centre. */
  setZoomLevel(z: number): void {
    const t = this.tree;
    if (!t) return;
    const total = t.total[0]!;
    const mid = (this.v0 + this.v1) / 2;
    const span = total / Math.max(1, Math.min(z, this.maxZoom()));
    this.setView(mid - span / 2, mid + span / 2);
  }

  /** Zoom so a node fills the width (0: the whole profile). */
  zoomTo(node: number, remember = true): void {
    const t = this.tree;
    if (!t || node < 0 || node >= t.total.length) return;
    if (remember && node !== this.zoomNode) this.history.push(this.zoomNode);
    this.zoomNode = node;
    this.setView(t.x[node]!, t.x[node]! + Math.max(t.total[node]!, 1e-300));
    if (node > 0) this.scrollToNode(node);
  }

  /** Back to the zoom before the last one, then up the tree; false at the whole profile. */
  zoomOut(): boolean {
    const t = this.tree;
    if (!t) return false;
    const prev = this.history.pop();
    if (prev !== undefined) {
      this.zoomTo(prev, false);
      return true;
    }
    if (this.zoomNode > 0) {
      this.zoomTo(t.parent[this.zoomNode]!, false);
      return true;
    }
    if (this.v0 > 0 || this.v1 < t.total[0]!) {
      this.setView(0, t.total[0]!);
      return true;
    }
    return false;
  }

  redraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  focus(): void {
    this.canvas.focus({ preventScroll: true });
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.root.remove();
  }

  // --- geometry ---------------------------------------------------------------------------

  private smallest(): number {
    const t = this.tree!;
    let min = Infinity;
    for (let i = 1; i < t.total.length; i++) if (t.total[i]! > 0 && t.total[i]! < min) min = t.total[i]!;
    return Number.isFinite(min) ? min : 1;
  }

  private setView(v0: number, v1: number): void {
    const t = this.tree;
    if (!t) return;
    const total = t.total[0]!;
    let span = Math.min(total, Math.max(v1 - v0, total / this.maxZoom()));
    if (!(span > 0)) span = total || 1;
    let a = Math.max(0, Math.min(v0, total - span));
    if (!Number.isFinite(a)) a = 0;
    this.v0 = a;
    this.v1 = a + span;
    this.redraw();
    this.onView?.();
  }

  /** Height of the drawing: the rows, or the view when they are fewer (the root stays at the bottom). */
  private contentH(): number {
    return Math.max((this.tree!.maxDepth + 1) * ROW + PAD * 2, this.scroller.clientHeight);
  }

  private y(depth: number): number {
    const t = this.tree!;
    return t.inverted ? PAD + depth * ROW : this.contentH() - PAD - (depth + 1) * ROW;
  }

  private depthAt(y: number): number {
    const t = this.tree!;
    return Math.floor(t.inverted ? (y - PAD) / ROW : (this.contentH() - PAD - y) / ROW);
  }

  /** The node under a point, in spacer coordinates. */
  private hit(x: number, y: number): number {
    const t = this.tree;
    if (!t || !this.width) return -1;
    const depth = this.depthAt(y);
    if (depth < 0 || depth > t.maxDepth) return -1;
    const v = this.v0 + (x / this.width) * (this.v1 - this.v0);
    let node = 0;
    if (v < 0 || v > t.total[0]!) return -1;
    for (let d = 0; d < depth; d++) {
      let next = -1;
      for (const c of t.children[node]!) {
        if (v >= t.x[c]! && v < t.x[c]! + t.total[c]!) {
          next = c;
          break;
        }
      }
      if (next < 0) return -1;
      node = next;
    }
    return node;
  }

  /** Frames from the root down to a node, to find the same path in a new tree. */
  private pathOf(node: number): number[] {
    const t = this.tree!;
    const out: number[] = [];
    for (let n = node; n > 0; n = t.parent[n]!) out.push(t.frame[n]!);
    return out.reverse();
  }

  private nodeAt(path: number[]): number {
    const t = this.tree!;
    let node = 0;
    for (const f of path) {
      const next = [...t.children[node]!].find((c) => t.frame[c] === f);
      if (next === undefined) return -1;
      node = next;
    }
    return node;
  }

  private scrollToNode(node: number): void {
    const t = this.tree!;
    const y = this.y(t.depth[node]!);
    const s = this.scroller;
    if (y < s.scrollTop + ROW || y > s.scrollTop + s.clientHeight - 2 * ROW) s.scrollTop = Math.max(0, y - s.clientHeight / 2);
  }

  private recolor(): void {
    const dark = isDark();
    this.colors = this.frames.map((f) => frameColor(f, this.mode, dark));
  }

  // --- events -----------------------------------------------------------------------------

  private bind(): void {
    const c = this.canvas;
    this.resize = new ResizeObserver(() => this.redraw());
    this.resize.observe(this.scroller);
    this.scroller.addEventListener("scroll", () => this.redraw(), { passive: true });
    c.style.touchAction = "pan-y";
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      this.drag = null;
    });
    c.addEventListener("pointerleave", () => {
      this.tip.hidden = true;
      this.onFocus?.(this.focusNode, false);
    });
    c.addEventListener("keydown", (e) => this.onKey(e));
    c.addEventListener("focus", () => {
      if (this.focusNode < 0) this.focusNode = this.zoomNode;
      this.onFocus?.(this.focusNode, true);
      this.redraw();
    });
    c.addEventListener("blur", () => this.redraw());
  }

  /** Spacer-relative y of a pointer event on the (sticky) canvas. */
  private py(e: PointerEvent | WheelEvent): number {
    return e.offsetY + this.scroller.scrollTop;
  }

  private zoomAround(factor: number, x: number): void {
    const v = this.v0 + (x / Math.max(1, this.width)) * (this.v1 - this.v0);
    this.setView(v - (v - this.v0) * factor, v + (this.v1 - v) * factor);
  }

  private onWheel(e: WheelEvent): void {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.zoomAround(Math.exp(e.deltaY * unit * 0.0025), e.offsetX);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const d = (e.deltaX || e.deltaY) * unit;
      const dv = (d / Math.max(1, this.width)) * (this.v1 - this.v0);
      this.setView(this.v0 + dv, this.v1 + dv);
    }
  }

  private onDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drag = { x: e.offsetX, y: e.offsetY, moved: false, v0: this.v0, v1: this.v1, top: this.scroller.scrollTop };
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (prev && this.pointers.size === 2) {
      // Pinch: zoom by the change in distance between the two fingers.
      const [a, b] = [...this.pointers.values()];
      const before = Math.abs(a!.x - b!.x) + Math.abs(a!.y - b!.y) / 4;
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const [c, d] = [...this.pointers.values()];
      const after = Math.abs(c!.x - d!.x) + Math.abs(c!.y - d!.y) / 4;
      if (before > 4 && after > 4) this.zoomAround(before / after, (c!.x + d!.x) / 2);
      this.drag = null;
      return;
    }
    if (prev) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const d = this.drag;
    if (d) {
      const dx = e.offsetX - d.x;
      const dy = e.offsetY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 5) {
        d.moved = true;
        // A mostly vertical finger scrolls the rows natively.
        d.vertical = e.pointerType !== "mouse" && Math.abs(dy) > Math.abs(dx);
      }
      if (d.moved && d.vertical) return;
      if (d.moved) {
        const dv = (-dx / Math.max(1, this.width)) * (d.v1 - d.v0);
        this.setView(d.v0 + dv, d.v1 + dv);
        if (e.pointerType === "mouse") this.scroller.scrollTop = d.top - dy;
        this.tip.hidden = true;
        return;
      }
    }
    if (e.pointerType === "mouse") this.hover(e.offsetX, this.py(e), e.offsetY);
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    const node = this.hit(e.offsetX, this.py(e));
    if (node < 0) return;
    this.focusNode = node;
    this.tip.hidden = true;
    this.zoomTo(node);
    this.onFocus?.(node, true);
    this.onPick?.(node);
  }

  private hover(x: number, y: number, viewY: number): void {
    const node = this.hit(x, y);
    if (node < 0) {
      this.tip.hidden = true;
      this.canvas.style.cursor = "";
      return;
    }
    this.canvas.style.cursor = "pointer";
    this.tip.textContent = this.text.describe(node);
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    const left = x + 14 + w > this.width ? Math.max(0, x - 14 - w) : x + 14;
    const top = viewY + 16 + h > this.height ? Math.max(0, viewY - 8 - h) : viewY + 16;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
    this.onFocus?.(node, false);
  }

  private onKey(e: KeyboardEvent): void {
    const t = this.tree;
    if (!t) return;
    let node = this.focusNode >= 0 ? this.focusNode : this.zoomNode;
    const up = t.inverted ? "ArrowDown" : "ArrowUp";
    const down = t.inverted ? "ArrowUp" : "ArrowDown";
    let handled = true;
    switch (e.key) {
      case up: {
        // Toward the leaves: the heaviest callee (or caller, inverted).
        const kids = t.children[node]!;
        if (kids.length) node = kids[0]!;
        break;
      }
      case down:
        if (node > 0) node = t.parent[node]!;
        break;
      case "ArrowLeft":
      case "ArrowRight":
        node = this.neighbour(node, e.key === "ArrowLeft" ? -1 : 1);
        break;
      case "Enter":
      case " ":
        this.zoomTo(node);
        this.onPick?.(node);
        break;
      case "Escape":
      case "Backspace":
        handled = this.zoomOut();
        break;
      case "Home":
        this.zoomTo(0);
        node = 0;
        break;
      case "+":
      case "=":
        this.zoomAround(0.7, this.width / 2);
        break;
      case "-":
      case "_":
        this.zoomAround(1 / 0.7, this.width / 2);
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    if (node !== this.focusNode) {
      this.focusNode = node;
      this.reveal(node);
      this.onFocus?.(node, true);
    }
    this.redraw();
  }

  /** The node drawn next to this one at the same depth, in either direction. */
  private neighbour(node: number, dir: -1 | 1): number {
    const t = this.tree!;
    const depth = t.depth[node]!;
    const edge = dir < 0 ? t.x[node]! - 1e-9 * t.total[0]! : t.x[node]! + t.total[node]! + 1e-9 * t.total[0]!;
    let at = 0;
    for (let d = 0; d < depth; d++) {
      const kids = t.children[at]!;
      let next = -1;
      for (const c of kids) if (edge >= t.x[c]! && edge < t.x[c]! + t.total[c]!) next = c;
      if (next < 0) return node;
      at = next;
    }
    return at > 0 && t.depth[at] === depth ? at : node;
  }

  /** Bring a node into view: scroll to its row and pan or zoom out to it. */
  private reveal(node: number): void {
    const t = this.tree!;
    const a = t.x[node]!;
    const b = a + t.total[node]!;
    if (a < this.v0 || b > this.v1) {
      const span = Math.max(this.v1 - this.v0, b - a);
      const mid = (a + b) / 2;
      this.setView(mid - span / 2, mid + span / 2);
    }
    this.scrollToNode(node);
  }

  // --- drawing ----------------------------------------------------------------------------

  private draw(): void {
    const t = this.tree;
    const w = this.scroller.clientWidth;
    const h = this.scroller.clientHeight;
    if (!t || !w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (w !== this.width || h !== this.height || dpr !== this.dpr) {
      this.width = w;
      this.height = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    // The spacer grows to the view, so a shallow flame graph still sits on the bottom edge.
    const ch = `${this.contentH()}px`;
    if (this.spacer.style.height !== ch) this.spacer.style.height = ch;
    const css = getComputedStyle(this.root);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    const bg = v("--canvas", "#fff");
    const text = v("--text", "#1c1e21");
    const accent = v("--accent", "#4f46e5");
    const dark = isDark();
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    this.charW = ctx.measureText("abcdefghijklmnopqrstuvwxyz").width / 26;
    const top = this.scroller.scrollTop;
    const scale = w / (this.v1 - this.v0);
    const min = 0.5 / scale;
    const searching = !!this.match;
    const dim = dark ? "hsl(220 8% 26%)" : "hsl(220 10% 88%)";
    const hi = dark ? "hsl(320 70% 58%)" : "hsl(320 75% 62%)";
    const stack: number[] = [0];
    while (stack.length) {
      const n = stack.pop()!;
      const tot = t.total[n]!;
      if (tot < min) continue;
      const x0 = t.x[n]!;
      if (x0 > this.v1 || x0 + tot < this.v0) continue;
      const kids = t.children[n]!;
      // Children too thin to draw (the lightest, so the last ones) share one plain block.
      let wide = kids.length;
      while (wide > 0 && t.total[kids[wide - 1]!]! < min) wide--;
      for (let k = wide - 1; k >= 0; k--) stack.push(kids[k]!);
      if (wide < kids.length) {
        const a = Math.max(0, (t.x[kids[wide]!]! - this.v0) * scale);
        const last = kids[kids.length - 1]!;
        const b = Math.min(w, (t.x[last]! + t.total[last]! - this.v0) * scale);
        const yk = this.y(t.depth[n]! + 1) - top;
        if (b - a >= 0.5 && yk <= h && yk + ROW >= 0) {
          ctx.fillStyle = dark ? "hsl(220 8% 32%)" : "hsl(220 10% 84%)";
          ctx.fillRect(a, yk, b - a, ROW - 1);
        }
      }
      const y = this.y(t.depth[n]!) - top;
      if (y > h || y + ROW < 0) continue;
      const px0 = Math.max(0, (x0 - this.v0) * scale);
      const px1 = Math.min(w, (x0 + tot - this.v0) * scale);
      const pw = px1 - px0;
      if (pw <= 0) continue;
      const f = t.frame[n]!;
      const matched = searching && f >= 0 && this.match![f] === 1;
      ctx.fillStyle = n === 0 ? (dark ? "hsl(220 10% 34%)" : "hsl(220 12% 80%)") : searching ? (matched ? hi : dim) : this.colors[f]!;
      ctx.fillRect(px0, y, Math.max(pw - (pw > 3 ? 1 : 0), 0.5), ROW - 1);
      if (pw > 24) {
        const label = n === 0 ? this.text.all : this.frames[f]!.name;
        ctx.fillStyle = searching && !matched && n > 0 ? v("--muted", "#6b7280") : dark ? "#f2f4f8" : "#14161a";
        if (n === 0) ctx.fillStyle = text;
        ctx.fillText(this.fit(label, pw - 6), px0 + 3, y + ROW / 2);
      }
    }
    // Focus ring on the focused node, when the canvas has the focus.
    const fnode = this.focusNode;
    if (fnode >= 0 && document.activeElement === this.canvas && fnode < t.total.length) {
      const y = this.y(t.depth[fnode]!) - top;
      const px0 = Math.max(0, (t.x[fnode]! - this.v0) * scale);
      const px1 = Math.min(w, (t.x[fnode]! + t.total[fnode]! - this.v0) * scale);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(px0 + 1, y + 1, Math.max(2, px1 - px0 - 2), ROW - 3);
    }
  }

  /** Text cut to fit a width, with an ellipsis. */
  private fit(s: string, width: number): string {
    const max = Math.floor(width / this.charW);
    if (max <= 1) return "";
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
  }
}
