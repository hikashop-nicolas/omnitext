import { isDark } from "./profile-flame";

// The samples-over-time strip: a histogram of the selected samples' weight along the profile,
// with markers as ticks under it. Dragging picks a time range; a click or Escape clears it.

export interface StripText {
  aria: string;
  /** "{from} to {to}" for a range, in the strip's time format. */
  range: (from: number, to: number) => string;
  all: string;
  time: (ns: number) => string;
}

const H = 44;
const LANE = 6;

export class TimeStrip {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private label: HTMLElement;
  private bins: Float64Array = new Float64Array(0);
  private markers: { start: number; dur: number; color: string }[] = [];
  private sel: [number, number] | null = null;
  private dragFrom = NaN;
  private width = 0;
  private dpr = 1;
  private frame = 0;
  private resize: ResizeObserver;
  /** Called with the new range (null: all of it) once the user picks one. */
  onRange: ((range: [number, number] | null) => void) | null = null;
  /** Asks for new bins when the strip's width changes. */
  onWidth: ((columns: number) => void) | null = null;

  constructor(
    host: HTMLElement,
    private span: number,
    private text: StripText,
  ) {
    this.root = document.createElement("div");
    this.root.className = "ot-prof-strip";
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "slider");
    this.canvas.setAttribute("aria-label", text.aria);
    this.canvas.setAttribute("aria-valuemin", "0");
    this.canvas.setAttribute("aria-valuemax", "100");
    this.label = document.createElement("div");
    this.label.className = "ot-prof-strip-label";
    this.label.setAttribute("aria-hidden", "true");
    this.root.append(this.canvas, this.label);
    host.append(this.root);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize = new ResizeObserver(() => {
      const w = this.canvas.clientWidth;
      if (w && w !== this.width) this.onWidth?.(Math.max(16, Math.floor(w)));
      this.redraw();
    });
    this.resize.observe(this.root);
    this.bind();
    this.showLabel();
  }

  columns(): number {
    return Math.max(16, Math.floor(this.canvas.clientWidth || 300));
  }

  setBins(bins: Float64Array): void {
    this.bins = bins;
    this.redraw();
  }

  setMarkers(markers: { start: number; dur: number; color: string }[]): void {
    this.markers = markers;
    this.redraw();
  }

  /** Select a range from outside (a marker), and report it. */
  select(range: [number, number] | null): void {
    this.sel = range && range[1] > range[0] ? range : null;
    this.showLabel();
    this.redraw();
    this.onRange?.(this.sel);
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.root.remove();
  }

  private timeAt(x: number): number {
    return Math.max(0, Math.min(this.span, (x / Math.max(1, this.canvas.clientWidth)) * this.span));
  }

  private bind(): void {
    const c = this.canvas;
    c.style.touchAction = "pan-y";
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      c.setPointerCapture?.(e.pointerId);
      this.dragFrom = e.offsetX;
    });
    c.addEventListener("pointermove", (e) => {
      if (Number.isNaN(this.dragFrom)) return;
      if (Math.abs(e.offsetX - this.dragFrom) < 4) return;
      const a = this.timeAt(Math.min(this.dragFrom, e.offsetX));
      const b = this.timeAt(Math.max(this.dragFrom, e.offsetX));
      this.sel = [a, b];
      this.showLabel();
      this.redraw();
    });
    const end = (e: PointerEvent) => {
      if (Number.isNaN(this.dragFrom)) return;
      const moved = Math.abs(e.offsetX - this.dragFrom) >= 4;
      this.dragFrom = NaN;
      // A tap clears the range; a drag sets it.
      this.select(moved ? this.sel : null);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", () => (this.dragFrom = NaN));
    c.addEventListener("keydown", (e) => {
      const step = this.span / 20;
      let [a, b] = this.sel ?? [0, this.span];
      let handled = true;
      if (e.key === "Escape") {
        if (!this.sel) return;
        this.select(null);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const d = e.key === "ArrowLeft" ? -step : step;
        if (!this.sel) [a, b] = [0, this.span / 4];
        // Shift moves the end only: the range grows or shrinks.
        if (e.shiftKey) b = Math.max(a + step / 4, Math.min(this.span, b + d));
        else {
          const w = b - a;
          a = Math.max(0, Math.min(this.span - w, a + d));
          b = a + w;
        }
      } else if (e.key === "Home") [a, b] = [0, b - a];
      else if (e.key === "End") [a, b] = [this.span - (b - a), this.span];
      else handled = false;
      if (!handled) return;
      e.preventDefault();
      this.select([a, b]);
    });
  }

  private showLabel(): void {
    const s = this.sel;
    const text = s ? this.text.range(s[0], s[1]) : `${this.text.all} · ${this.text.time(this.span)}`;
    this.label.textContent = text;
    this.canvas.setAttribute("aria-valuetext", text);
    this.canvas.setAttribute("aria-valuenow", String(s ? Math.round((s[0] / this.span) * 100) : 0));
  }

  private redraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const w = this.canvas.clientWidth;
    if (!w) return;
    const lane = this.markers.length ? LANE + 2 : 0;
    const h = H + lane;
    const dpr = window.devicePixelRatio || 1;
    if (w !== this.width || dpr !== this.dpr || this.canvas.height !== Math.round(h * dpr)) {
      this.width = w;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.height = `${h}px`;
    }
    const css = getComputedStyle(this.root);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = v("--canvas", "#fff");
    ctx.fillRect(0, 0, w, h);
    let max = 0;
    for (const b of this.bins) if (b > max) max = b;
    const n = this.bins.length;
    const accent = v("--accent", "#4f46e5");
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55;
    if (max > 0) {
      for (let i = 0; i < n; i++) {
        const bh = (this.bins[i]! / max) * (H - 4);
        if (bh <= 0) continue;
        const x0 = (i / n) * w;
        ctx.fillRect(x0, H - bh, Math.max(1, w / n), bh);
      }
    }
    ctx.globalAlpha = 1;
    if (lane) {
      for (const m of this.markers) {
        const x0 = (m.start / this.span) * w;
        ctx.fillStyle = m.color;
        ctx.fillRect(x0, H + 2, Math.max(1, (m.dur / this.span) * w), LANE);
      }
    }
    const s = this.sel;
    if (s) {
      const a = (s[0] / this.span) * w;
      const b = (s[1] / this.span) * w;
      // Shade what is left out.
      ctx.fillStyle = isDark() ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.65)";
      ctx.fillRect(0, 0, a, h);
      ctx.fillRect(b, 0, w - b, h);
      ctx.fillStyle = accent;
      ctx.fillRect(a, 0, 1.5, h);
      ctx.fillRect(b - 1.5, 0, 1.5, h);
    }
  }
}
