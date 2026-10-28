import type { DeckSession, Rendered } from "craftbridge/deck";

// Plays a slide show on one or more canvases: the slide's transition, then its animations a click at a time. The engine draws
// each frame (renderTransition, renderStep); this keeps the clock and the position.

export interface Surface {
  canvas: HTMLCanvasElement;
  size(): { w: number; h: number };
  dpr: number;
}

export interface ShowHost {
  session: DeckSession;
  /** Runs an engine call after what is queued; undefined when it failed. */
  call<T>(fn: () => Promise<T>): Promise<T | undefined>;
  total: number;
  /** Slides left out of the show. */
  hidden?: boolean[];
  loop?: boolean;
  noAnimation?: boolean;
  /** The slides the show covers (inclusive). */
  range?: [number, number];
  slideW: number;
  slideH: number;
  surfaces(): Surface[];
  transition(index: number): Promise<{ kind: string; ms: number; afterMs: number | null } | null>;
  /** The slide is on screen and at rest at its first step. */
  onSlide(index: number): void;
  /** The slide is about to change or the show ends. */
  onLeave(): void;
}

function paint(canvas: HTMLCanvasElement, r: Rendered, dpr: number): void {
  if (canvas.width !== r.width || canvas.height !== r.height) {
    canvas.width = r.width;
    canvas.height = r.height;
  }
  const px = new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer, r.rgba.byteOffset, r.rgba.byteLength);
  canvas.getContext("2d")?.putImageData(new ImageData(px, r.width, r.height), 0, 0);
  canvas.style.width = `${r.width / dpr}px`;
  canvas.style.height = `${r.height / dpr}px`;
}

export class ShowRunner {
  index = 0;
  step = 0;
  steps = 0;
  private auto: boolean[] = [];
  private durations: number[] = [];
  private gen = 0;
  private busy = false;
  private skip = false;
  private afterTimer = 0;
  private stopped = false;

  constructor(private readonly h: ShowHost) {}

  get playing(): boolean {
    return this.busy;
  }

  stop(): void {
    this.stopped = true;
    this.gen++;
    window.clearTimeout(this.afterTimer);
  }

  /** Draws the state the show is at, again (after the window changed size). */
  async redraw(): Promise<void> {
    await this.frame("step", this.index, this.step, 0, this.gen);
  }

  /** Shows slide `index`; `forward` plays its transition, `built` shows it with every animation done. */
  async goto(index: number, o: { forward?: boolean; built?: boolean } = {}): Promise<void> {
    if (this.stopped) return;
    const gen = ++this.gen;
    window.clearTimeout(this.afterTimer);
    this.h.onLeave();
    this.busy = false;
    this.skip = false;
    this.index = Math.min(this.h.total - 1, Math.max(0, index));
    const info = await this.h.call(() => this.h.session.showInfo(this.index));
    if (gen !== this.gen) return;
    this.steps = info?.steps ?? 0;
    this.auto = info?.auto ?? [];
    this.durations = info?.durations ?? [];
    const idx = this.index;
    const tr = o.forward ? await this.h.transition(idx) : null;
    if (gen !== this.gen) return;
    if (tr && tr.kind !== "none" && tr.ms > 0) {
      this.busy = true;
      await this.animate(tr.ms / 1000, gen, (t) => this.frame("tr", idx, 0, t / (tr.ms / 1000), gen));
      this.busy = false;
      if (gen !== this.gen) return;
    }
    this.step = o.built || this.h.noAnimation ? this.steps : 0;
    await this.frame("step", idx, this.step, 0, gen);
    if (gen !== this.gen) return;
    this.h.onSlide(idx);
    if (!o.built && !this.h.noAnimation && this.steps > 0 && this.auto[0]) await this.playStep(0, gen);
    if (gen === this.gen && tr?.afterMs) this.afterTimer = window.setTimeout(() => void this.next(), tr.afterMs);
  }

  /** A click or the right arrow: the next animation, or the next slide when the slide is built. */
  async next(): Promise<void> {
    if (this.stopped) return;
    if (this.busy) {
      this.skip = true;
      return;
    }
    if (this.step < this.steps) return this.playStep(this.step, this.gen);
    const to = this.neighbour(1);
    if (to !== null) await this.goto(to, { forward: true });
    else if (this.h.loop) await this.goto(this.first(), { forward: true });
  }

  private lo(): number {
    return this.h.range?.[0] ?? 0;
  }

  private hi(): number {
    return Math.min(this.h.total - 1, this.h.range?.[1] ?? this.h.total - 1);
  }

  /** The first slide of the show (hidden slides and the range left out). */
  first(): number {
    for (let i = this.lo(); i <= this.hi(); i++) if (!this.h.hidden?.[i]) return i;
    return this.lo();
  }

  /** The next shown slide in a direction, or null at the end. */
  private neighbour(dir: 1 | -1): number | null {
    for (let i = this.index + dir; i >= this.lo() && i <= this.hi(); i += dir) if (!this.h.hidden?.[i]) return i;
    return null;
  }

  async prev(): Promise<void> {
    if (this.stopped) return;
    if (this.busy) {
      this.skip = true;
      return;
    }
    const to = this.neighbour(-1);
    if (to !== null) await this.goto(to, { built: true });
  }

  private async playStep(i: number, gen: number): Promise<void> {
    const idx = this.index;
    this.busy = true;
    this.skip = false;
    await this.animate(this.durations[i] ?? 0, gen, (t) => this.frame("step", idx, i, t, gen));
    this.busy = false;
    if (gen !== this.gen) return;
    this.step = i + 1;
    await this.frame("step", idx, this.step, 0, gen);
    if (gen === this.gen && this.step < this.steps && this.auto[this.step]) await this.playStep(this.step, gen);
  }

  private async animate(seconds: number, gen: number, frame: (t: number) => Promise<boolean>): Promise<void> {
    const t0 = performance.now();
    while (gen === this.gen && !this.skip) {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) break;
      if (!(await frame(t))) return;
    }
    this.skip = false;
  }

  private async frame(kind: "tr" | "step", index: number, a: number, t: number, gen: number): Promise<boolean> {
    for (const s of this.h.surfaces()) {
      const { w, h } = s.size();
      const scale = Math.max(0.05, Math.min(w / this.h.slideW, h / this.h.slideH)) * s.dpr;
      const r = await this.h.call(() => (kind === "tr" ? this.h.session.renderTransition(index, Math.min(1, Math.max(0, t)), scale) : this.h.session.renderStep(index, a, t, scale)));
      if (!r || gen !== this.gen) return false;
      paint(s.canvas, r, s.dpr);
    }
    return true;
  }
}
