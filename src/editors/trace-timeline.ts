import type { CounterTrack, CpuTrack, SliceTrack, Track, TraceModel, TrackGroup } from "./trace-model";
import { clampRange, counterColumns, durationUnit, niceStep, sliceBlocks, tickUnit, upperBound, zoomRange, type TimeUnit } from "./trace-range";

// Canvas timeline: a ruler, then rows grouped by CPU and by process. Only the visible rows and
// the visible time range are drawn, with sub-pixel slices merged per pixel column (trace-range).

export interface TimelineSelection {
  track: SliceTrack | CpuTrack;
  level: number;
  index: number;
}

export interface TimelineText {
  aria: string;
}

interface Row {
  kind: "group" | "track";
  group: TrackGroup;
  track?: Track;
  y: number;
  h: number;
}

const RULER = 26;
const GROUP_H = 24;
const LEVEL_H = 16;
const CPU_H = 20;
const COUNTER_H = 32;

function hash(s: string | number): number {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const isDark = (): boolean => {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
};

export class Timeline {
  readonly root: HTMLElement;
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private rows: Row[] = [];
  private collapsed = new Set<string>();
  private filter = "";
  private highlight: Set<number> | null = null;
  private selection: TimelineSelection | null = null;
  private t0: number;
  private t1: number;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private colors = new Map<string, string>();
  private dark = false;
  private fmts = new Map<string, Intl.NumberFormat>();
  private resize: ResizeObserver | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: boolean; t0: number; t1: number; top: number } | null = null;

  constructor(
    host: HTMLElement,
    private model: TraceModel,
    text: TimelineText,
    private locale: string,
    private onSelect: (sel: TimelineSelection | null) => void,
  ) {
    this.t0 = model.start;
    this.t1 = Math.max(model.end, model.start + 1000);
    // Many processes start folded, as Perfetto does; a small trace shows everything.
    const procs = model.groups.filter((g) => g.key !== "cpu");
    if (procs.length > 12) for (const g of procs) this.collapsed.add(g.key);
    this.root = document.createElement("div");
    this.root.className = "ot-tl";
    this.scroller = document.createElement("div");
    this.scroller.className = "ot-tl-scroll";
    this.spacer = document.createElement("div");
    this.spacer.className = "ot-tl-spacer";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "ot-tl-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-label", text.aria);
    this.tip = document.createElement("div");
    this.tip.className = "ot-tl-tip";
    this.tip.hidden = true;
    this.spacer.append(this.canvas);
    this.scroller.append(this.spacer);
    this.root.append(this.scroller, this.tip);
    host.append(this.root);
    this.ctx = this.canvas.getContext("2d")!;
    this.layout();
    this.bind();
  }

  // --- public ---------------------------------------------------------------------------

  setFilter(text: string): void {
    this.filter = text.trim().toLowerCase();
    this.layout();
  }

  setAllCollapsed(collapsed: boolean): void {
    this.collapsed.clear();
    if (collapsed) for (const g of this.model.groups) if (g.key !== "cpu") this.collapsed.add(g.key);
    this.layout();
  }

  setHighlight(names: Set<number> | null): void {
    this.highlight = names;
    this.redraw();
  }

  /** Selects a slice and brings it into view: unfolds its group, scrolls, zooms when it is tiny. */
  reveal(sel: TimelineSelection): void {
    this.selection = sel;
    const g = this.model.groups.find((gr) => gr.tracks.includes(sel.track));
    if (g && this.collapsed.delete(g.key)) this.layout();
    const { ts, dur } = this.at(sel);
    const span = this.t1 - this.t0;
    const scale = this.plotWidth() / span;
    let a = this.t0;
    let b = this.t1;
    if (dur > span * 0.8) [a, b] = [ts - dur * 0.1, ts + dur * 1.1];
    else if (dur > 0 && dur * scale < 2) [a, b] = [ts + dur / 2 - dur * 10, ts + dur / 2 + dur * 10];
    else if (ts + dur < this.t0 || ts > this.t1) [a, b] = [ts + dur / 2 - span / 2, ts + dur / 2 + span / 2];
    [this.t0, this.t1] = clampRange(a, b, this.model.start, this.model.end);
    const row = this.rows.find((r) => r.track === sel.track);
    if (row) {
      const y = row.y + (sel.level + 0.5) * LEVEL_H;
      const view = this.scroller.clientHeight - RULER;
      if (y < this.scroller.scrollTop || y > this.scroller.scrollTop + view - LEVEL_H) this.scroller.scrollTop = Math.max(0, y - view / 2);
    }
    this.redraw();
    this.onSelect(sel);
  }

  select(sel: TimelineSelection | null): void {
    this.selection = sel;
    this.redraw();
    this.onSelect(sel);
  }

  focus(): void {
    this.canvas.focus();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.root.remove();
  }

  // --- layout -----------------------------------------------------------------------------

  private visibleTracks(g: TrackGroup): Track[] {
    if (!this.filter || g.key === "cpu") return g.tracks;
    if (g.label.toLowerCase().includes(this.filter)) return g.tracks;
    return g.tracks.filter((t) => t.label.toLowerCase().includes(this.filter));
  }

  private layout(): void {
    const rows: Row[] = [];
    let y = 0;
    for (const g of this.model.groups) {
      const tracks = this.visibleTracks(g);
      if (!tracks.length) continue;
      rows.push({ kind: "group", group: g, y, h: GROUP_H });
      y += GROUP_H;
      if (this.collapsed.has(g.key)) continue;
      for (const t of tracks) {
        const h = t.kind === "slices" ? Math.max(1, t.levels.length) * LEVEL_H + 4 : t.kind === "cpu" ? CPU_H : COUNTER_H;
        rows.push({ kind: "track", group: g, track: t, y, h });
        y += h;
      }
    }
    this.rows = rows;
    this.spacer.style.height = `${RULER + y + 8}px`;
    this.redraw();
  }

  private labelWidth(): number {
    return Math.round(Math.min(220, Math.max(96, this.width * 0.22)));
  }

  private plotWidth(): number {
    return Math.max(10, this.width - this.labelWidth());
  }

  private at(sel: TimelineSelection): { ts: number; dur: number } {
    if (sel.track.kind === "cpu") return { ts: sel.track.ts[sel.index]!, dur: sel.track.dur[sel.index]! };
    const lv = sel.track.levels[sel.level]!;
    return { ts: lv.ts[sel.index]!, dur: lv.dur[sel.index]! };
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
    c.addEventListener("pointerleave", () => (this.tip.hidden = true));
    c.addEventListener("keydown", (e) => this.onKey(e));
  }

  private timeAt(x: number): number {
    return this.t0 + ((x - this.labelWidth()) / this.plotWidth()) * (this.t1 - this.t0);
  }

  private zoom(factor: number, anchor: number): void {
    [this.t0, this.t1] = zoomRange(this.t0, this.t1, anchor, factor, this.model.start, this.model.end, 100);
    this.redraw();
  }

  private pan(dt: number): void {
    [this.t0, this.t1] = clampRange(this.t0 + dt, this.t1 + dt, this.model.start, this.model.end);
    this.redraw();
  }

  private onWheel(e: WheelEvent): void {
    const x = e.offsetX;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * unit * 0.0025), this.timeAt(Math.max(x, this.labelWidth())));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const d = (e.deltaX || e.deltaY) * unit;
      this.pan((d / this.plotWidth()) * (this.t1 - this.t0));
    }
  }

  private onDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drag = { x: e.offsetX, y: e.offsetY, moved: false, t0: this.t0, t1: this.t1, top: this.scroller.scrollTop };
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (prev && this.pointers.size === 2) {
      // Pinch: zoom by the change in distance between the two fingers.
      const [a, b] = [...this.pointers.values()];
      const before = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const [c, d] = [...this.pointers.values()];
      const after = Math.hypot(c!.x - d!.x, c!.y - d!.y);
      if (before > 0 && after > 0) this.zoom(before / after, this.timeAt((c!.x + d!.x) / 2));
      this.drag = null;
      return;
    }
    if (prev) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const d = this.drag;
    if (d) {
      const dx = e.offsetX - d.x;
      const dy = e.offsetY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) {
        const dt = (-dx / this.plotWidth()) * (d.t1 - d.t0);
        [this.t0, this.t1] = clampRange(d.t0 + dt, d.t1 + dt, this.model.start, this.model.end);
        if (e.pointerType === "mouse") this.scroller.scrollTop = d.top - dy;
        this.tip.hidden = true;
        this.redraw();
        return;
      }
    }
    if (e.pointerType === "mouse") this.hover(e.offsetX, e.offsetY);
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    const hit = this.hit(e.offsetX, e.offsetY);
    if (hit?.row.kind === "group") {
      this.toggle(hit.row.group.key);
      return;
    }
    if (e.offsetX < this.labelWidth() && hit?.row.kind === "track") return;
    this.select(hit?.sel ?? null);
  }

  private toggle(key: string): void {
    if (!this.collapsed.delete(key)) this.collapsed.add(key);
    this.layout();
  }

  private onKey(e: KeyboardEvent): void {
    const span = this.t1 - this.t0;
    const mid = this.selection ? this.at(this.selection).ts : (this.t0 + this.t1) / 2;
    const anchor = mid >= this.t0 && mid <= this.t1 ? mid : (this.t0 + this.t1) / 2;
    let handled = true;
    switch (e.key) {
      case "+":
      case "=":
        this.zoom(0.7, anchor);
        break;
      case "-":
      case "_":
        this.zoom(1 / 0.7, anchor);
        break;
      case "ArrowLeft":
        this.pan(-span * (e.shiftKey ? 0.5 : 0.1));
        break;
      case "ArrowRight":
        this.pan(span * (e.shiftKey ? 0.5 : 0.1));
        break;
      case "ArrowUp":
        this.scroller.scrollTop -= 40;
        break;
      case "ArrowDown":
        this.scroller.scrollTop += 40;
        break;
      case "PageUp":
        this.scroller.scrollTop -= this.scroller.clientHeight - RULER;
        break;
      case "PageDown":
        this.scroller.scrollTop += this.scroller.clientHeight - RULER;
        break;
      case "Home":
      case "0":
        [this.t0, this.t1] = [this.model.start, Math.max(this.model.end, this.model.start + 1000)];
        this.redraw();
        break;
      case "Escape":
        this.select(null);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  // --- hit testing ------------------------------------------------------------------------

  private rowAt(y: number): Row | null {
    const cy = y - RULER + this.scroller.scrollTop;
    if (y < RULER || cy < 0) return null;
    let lo = 0;
    let hi = this.rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.rows[mid]!;
      if (cy < r.y) hi = mid - 1;
      else if (cy >= r.y + r.h) lo = mid + 1;
      else return r;
    }
    return null;
  }

  private hit(x: number, y: number): { row: Row; sel?: TimelineSelection; counter?: { track: CounterTrack; index: number } } | null {
    const row = this.rowAt(y);
    if (!row) return null;
    if (row.kind === "group" || !row.track || x < this.labelWidth()) return { row };
    const t = this.timeAt(x);
    const slack = (3 / this.plotWidth()) * (this.t1 - this.t0);
    const pick = (ts: Float64Array, dur: Float64Array): number => {
      const i = upperBound(ts, t) - 1;
      if (i >= 0 && ts[i]! + dur[i]! >= t - slack) return i;
      if (i + 1 < ts.length && ts[i + 1]! - t <= slack) return i + 1;
      return -1;
    };
    const tr = row.track;
    if (tr.kind === "counter") {
      const i = upperBound(tr.ts, t) - 1;
      return i >= 0 ? { row, counter: { track: tr, index: i } } : { row };
    }
    if (tr.kind === "cpu") {
      const i = pick(tr.ts, tr.dur);
      return i >= 0 ? { row, sel: { track: tr, level: 0, index: i } } : { row };
    }
    const cy = y - RULER + this.scroller.scrollTop - row.y - 2;
    const level = Math.floor(cy / LEVEL_H);
    const lv = tr.levels[level];
    if (!lv) return { row };
    const i = pick(lv.ts, lv.dur);
    return i >= 0 ? { row, sel: { track: tr, level, index: i } } : { row };
  }

  private hover(x: number, y: number): void {
    const hit = this.hit(x, y);
    let text = "";
    if (hit?.sel) {
      const { ts, dur } = this.at(hit.sel);
      const name = hit.sel.track.kind === "cpu" ? this.threadName(hit.sel.track.tid[hit.sel.index]!) : this.model.names[hit.sel.track.levels[hit.sel.level]!.name[hit.sel.index]!] ?? "";
      text = `${name}\n${this.formatDuration(dur)} @ ${this.formatTime(ts - this.model.start)}`;
    } else if (hit?.counter) {
      const c = hit.counter;
      text = `${c.track.label}\n${c.track.val[c.index]!.toLocaleString(this.locale)}`;
    } else if (hit?.row.kind === "group") {
      text = hit.row.group.label;
    }
    if (!text) {
      this.tip.hidden = true;
      return;
    }
    this.tip.textContent = text;
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(x + 12, this.width - w - 4)}px`;
    this.tip.style.top = `${y + 16}px`;
  }

  threadName(tid: number): string {
    const th = this.model.threads.get(tid);
    return th?.name ? `${th.name} ${tid}` : String(tid);
  }

  // --- formatting -------------------------------------------------------------------------

  private fmt(unit: TimeUnit, digits: number): Intl.NumberFormat {
    const key = `${unit}:${digits}`;
    let f = this.fmts.get(key);
    if (!f) {
      try {
        f = new Intl.NumberFormat(this.locale, { style: "unit", unit, unitDisplay: "narrow", maximumFractionDigits: digits, minimumFractionDigits: 0 });
      } catch {
        f = new Intl.NumberFormat(this.locale, { maximumFractionDigits: digits });
      }
      this.fmts.set(key, f);
    }
    return f;
  }

  formatDuration(ns: number): string {
    const [unit, size] = durationUnit(ns);
    return this.fmt(unit, 3).format(ns / size);
  }

  formatTime(ns: number): string {
    return this.formatDuration(ns);
  }

  // --- drawing ----------------------------------------------------------------------------

  redraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private color(key: string, s: number): string {
    let c = this.colors.get(key);
    if (!c) {
      const h = hash(key);
      c = this.dark ? `hsl(${h % 360} ${40 + (h >> 9) % 25}% ${s === 0 ? 36 : 32}%)` : `hsl(${h % 360} ${45 + (h >> 9) % 25}% ${s === 0 ? 72 : 76}%)`;
      if (this.colors.size > 20000) this.colors.clear();
      this.colors.set(key, c);
    }
    return c;
  }

  private draw(): void {
    const w = this.scroller.clientWidth;
    const h = this.scroller.clientHeight;
    if (!w || !h) return;
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
    const dark = isDark();
    if (dark !== this.dark) {
      this.dark = dark;
      this.colors.clear();
    }
    const css = getComputedStyle(this.root);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    const theme = {
      bg: v("--canvas", "#fff"), chrome: v("--chrome", "#fbfbfd"), border: v("--border", "#e4e6eb"),
      text: v("--text", "#1c1e21"), muted: v("--muted", "#6b7280"), accent: v("--accent", "#4f46e5"),
    };
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const L = this.labelWidth();
    const pw = this.plotWidth();
    const scale = pw / (this.t1 - this.t0);
    const top = this.scroller.scrollTop;
    const step = niceStep(90 / scale);
    // Grid lines first, so slices draw over them.
    const firstTick = this.model.start + Math.ceil((this.t0 - this.model.start) / step) * step;
    ctx.fillStyle = theme.border;
    for (let t = firstTick; t <= this.t1; t += step) ctx.fillRect(L + Math.round((t - this.t0) * scale), RULER, 1, h - RULER);
    // Rows.
    let i = 0;
    while (i < this.rows.length && this.rows[i]!.y + this.rows[i]!.h < top) i++;
    for (; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const y = RULER + row.y - top;
      if (y > h) break;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, Math.max(y, RULER), w, row.h);
      ctx.clip();
      if (row.kind === "group") this.drawGroup(row, y, w, theme);
      else this.drawTrack(row, y, L, pw, scale, theme);
      ctx.restore();
    }
    // Ruler on top.
    ctx.fillStyle = theme.chrome;
    ctx.fillRect(0, 0, w, RULER);
    ctx.fillStyle = theme.border;
    ctx.fillRect(0, RULER - 1, w, 1);
    ctx.fillRect(L - 1, 0, 1, h);
    const [unit, size] = tickUnit(step);
    const digits = Math.max(0, -Math.floor(Math.log10(step / size) + 1e-9));
    const f = this.fmt(unit, digits);
    ctx.fillStyle = theme.muted;
    for (let t = firstTick; t <= this.t1; t += step) {
      const x = L + Math.round((t - this.t0) * scale);
      ctx.fillRect(x, RULER - 6, 1, 5);
      ctx.fillText(f.format((t - this.model.start) / size), x + 3, RULER / 2 - 2);
    }
    ctx.fillStyle = theme.muted;
    ctx.fillText(this.formatDuration(this.t1 - this.t0), 8, RULER / 2);
  }

  private drawGroup(row: Row, y: number, w: number, theme: Record<string, string>): void {
    const ctx = this.ctx;
    ctx.fillStyle = theme.chrome!;
    ctx.fillRect(0, y, w, row.h);
    ctx.fillStyle = theme.border!;
    ctx.fillRect(0, y + row.h - 1, w, 1);
    const collapsed = this.collapsed.has(row.group.key);
    ctx.fillStyle = theme.text!;
    ctx.font = "600 12px system-ui, sans-serif";
    const tracks = this.visibleTracks(row.group).length;
    ctx.fillText(`${collapsed ? "▸" : "▾"} ${row.group.label || "…"}  (${tracks})`, 8, y + row.h / 2);
    ctx.font = "11px system-ui, sans-serif";
  }

  private drawTrack(row: Row, y: number, L: number, pw: number, scale: number, theme: Record<string, string>): void {
    const ctx = this.ctx;
    const t = row.track!;
    ctx.fillStyle = theme.border!;
    ctx.fillRect(0, y + row.h - 1, this.width, 1);
    // Label.
    ctx.fillStyle = theme.text!;
    const label = t.label || "…";
    const maxChars = Math.max(3, Math.floor((L - 16) / 6.2));
    ctx.fillText(label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label, 14, y + Math.min(row.h, LEVEL_H + 4) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, y, pw, row.h);
    ctx.clip();
    if (t.kind === "slices") this.drawSlices(t, y + 2, L, pw, scale);
    else if (t.kind === "cpu") this.drawCpu(t, y + 2, L, pw, scale);
    else this.drawCounter(t, y, row.h, L, pw, scale, theme);
    ctx.restore();
  }

  private drawSlices(t: SliceTrack, y: number, L: number, pw: number, scale: number): void {
    const ctx = this.ctx;
    const names = this.model.names;
    const hl = this.highlight;
    const sel = this.selection?.track === t ? this.selection : null;
    for (let d = 0; d < t.levels.length; d++) {
      const lv = t.levels[d]!;
      const ly = y + d * LEVEL_H;
      sliceBlocks(lv.ts, lv.dur, this.t0, pw, scale, (x0, x1, i) => {
        const name = names[lv.name[i]!] ?? "";
        ctx.globalAlpha = hl && !hl.has(lv.name[i]!) ? 0.22 : 1;
        ctx.fillStyle = this.color(name, d & 1);
        const bw = Math.max(1, x1 - x0 - (x1 - x0 > 3 ? 1 : 0));
        ctx.fillRect(L + x0, ly, bw, LEVEL_H - 1);
        if (bw > 28) this.label(name, L + Math.max(x0, 0), ly, Math.min(bw, pw - Math.max(x0, 0)));
      });
      if (sel && sel.level === d) this.outline(lv.ts[sel.index]!, lv.dur[sel.index]!, ly, L, scale);
    }
    ctx.globalAlpha = 1;
  }

  private drawCpu(t: CpuTrack, y: number, L: number, pw: number, scale: number): void {
    const ctx = this.ctx;
    const hl = this.highlight;
    sliceBlocks(t.ts, t.dur, this.t0, pw, scale, (x0, x1, i) => {
      const tid = t.tid[i]!;
      ctx.globalAlpha = hl ? 0.35 : 1;
      ctx.fillStyle = this.color(`tid${tid}`, 0);
      const bw = Math.max(1, x1 - x0 - (x1 - x0 > 3 ? 1 : 0));
      ctx.fillRect(L + x0, y, bw, CPU_H - 5);
      if (bw > 28) this.label(this.threadName(tid), L + Math.max(x0, 0), y - 1, Math.min(bw, pw - Math.max(x0, 0)));
    });
    ctx.globalAlpha = 1;
    const sel = this.selection?.track === t ? this.selection : null;
    if (sel) this.outline(t.ts[sel.index]!, t.dur[sel.index]!, y, L, scale);
  }

  private drawCounter(t: CounterTrack, y: number, h: number, L: number, pw: number, scale: number, theme: Record<string, string>): void {
    const ctx = this.ctx;
    const range = t.max - t.min || 1;
    const base = y + h - 3;
    const span = h - 8;
    ctx.fillStyle = theme.accent!;
    ctx.globalAlpha = 0.55;
    counterColumns(t.ts, t.val, this.t0, pw, scale, (x, lo, hi) => {
      const yHi = base - ((hi - t.min) / range) * span;
      const yLo = base - ((lo - t.min) / range) * span;
      ctx.fillRect(L + x, yHi, 1, Math.max(1, base - yHi));
      if (yLo - yHi > 1) ctx.fillRect(L + x, yHi, 1, yLo - yHi);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.muted!;
    ctx.fillText(t.max.toLocaleString(this.locale, { maximumFractionDigits: 2 }), L + 4, y + 8);
  }

  private label(text: string, x: number, y: number, w: number): void {
    const n = Math.floor((w - 6) / 6.2);
    if (n < 2) return;
    this.ctx.fillStyle = this.dark ? "#f2f4f8" : "#14161a";
    this.ctx.fillText(text.length > n ? text.slice(0, n - 1) + "…" : text, x + 3, y + LEVEL_H / 2);
  }

  private outline(ts: number, dur: number, y: number, L: number, scale: number): void {
    const ctx = this.ctx;
    const x0 = L + (ts - this.t0) * scale;
    const w = Math.max(2, dur * scale);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.dark ? "#ffffff" : "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y + 1, w, LEVEL_H - 3);
  }
}

