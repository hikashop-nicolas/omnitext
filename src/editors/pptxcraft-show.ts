import type { DeckSession, Rendered, TriggerPlay } from "craftbridge/deck";

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
  /** A custom show: the slides to play, in order (hidden slides and the range do not apply). */
  order?: number[];
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
  private trig = new Map<number, { steps: number; durations: number[]; done: number }>();
  private trigClock: { trigger: number; t: number } | null = null;
  private durations: number[] = [];
  private gen = 0;
  private busy = false;
  private inTransition = false;
  private scratch: HTMLCanvasElement | null = null;
  private skip = false;
  private afterTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly h: ShowHost) {}

  get playing(): boolean {
    return this.busy;
  }

  stop(): void {
    this.stopped = true;
    this.gen++;
    clearTimeout(this.afterTimer);
  }

  /** Draws the state the show is at, again (after the window changed size). */
  async redraw(): Promise<void> {
    await this.frame("step", this.index, this.step, 0, this.gen);
  }

  /** Shows slide `index`; `forward` plays its transition, `built` shows it with every animation done. */
  async goto(index: number, o: { forward?: boolean; built?: boolean } = {}): Promise<void> {
    if (this.stopped) return;
    const gen = ++this.gen;
    clearTimeout(this.afterTimer);
    this.h.onLeave();
    this.busy = false;
    this.inTransition = false;
    this.skip = false;
    this.index = Math.min(this.h.total - 1, Math.max(0, index));
    const info = await this.h.call(() => this.h.session.showInfo(this.index));
    if (gen !== this.gen) return;
    this.steps = info?.steps ?? 0;
    this.auto = info?.auto ?? [];
    this.durations = info?.durations ?? [];
    this.trig = new Map((info?.triggers ?? []).map((x) => [x.shape, { steps: x.steps, durations: x.durations, done: 0 }]));
    this.trigClock = null;
    const idx = this.index;
    const tr = o.forward ? await this.h.transition(idx) : null;
    if (gen !== this.gen) return;
    if (tr && tr.kind !== "none" && tr.ms > 0) {
      this.busy = true;
      this.inTransition = true;
      // the two slides are drawn once, at the size of the biggest screen; each frame only composites them
      const biggest = Math.max(...this.h.surfaces().map((s) => { const z = s.size(); return Math.min(z.w / this.h.slideW, z.h / this.h.slideH) * s.dpr; }), 0.05);
      const cached = await this.h.call(() => this.h.session.transitionBegin(idx, biggest));
      if (gen !== this.gen) { this.inTransition = false; return; }
      const dur = tr.ms / 1000;
      await this.animate(dur, gen, (t) => (cached ? this.cachedFrame(t / dur, gen) : this.frame("tr", idx, 0, t / dur, gen)));
      this.busy = false;
      this.inTransition = false;
      if (gen !== this.gen) return;
    }
    this.step = o.built || this.h.noAnimation ? this.steps : 0;
    await this.frame("step", idx, this.step, 0, gen);
    if (gen !== this.gen) return;
    this.h.onSlide(idx);
    if (!o.built && !this.h.noAnimation && this.steps > 0 && this.auto[0]) await this.playStep(0, gen);
    if (gen === this.gen && tr?.afterMs) this.afterTimer = setTimeout(() => void this.next(), tr.afterMs);
  }

  /** Does clicking this shape start a sequence of its own? */
  isTrigger(shape: number): boolean {
    const v = this.trig.get(shape);
    return !!v && v.done < v.steps;
  }

  /** A click on a trigger shape: its next animation plays, over whatever is on screen. */
  async triggerClick(shape: number): Promise<void> {
    const v = this.trig.get(shape);
    if (this.stopped || !v || v.done >= v.steps) return;
    if (this.busy) {
      this.skip = true;
      return;
    }
    // a trigger keeps the place its first click gave it in the order the sequences were started
    this.trig.delete(shape);
    this.trig.set(shape, v);
    const gen = this.gen;
    const idx = this.index;
    this.busy = true;
    this.skip = false;
    await this.animate(v.durations[v.done] ?? 0, gen, (t) => {
      this.trigClock = { trigger: shape, t };
      return this.frame("step", idx, this.step, 0, gen);
    });
    this.busy = false;
    this.trigClock = null;
    if (gen !== this.gen) return;
    v.done++;
    await this.frame("step", idx, this.step, 0, gen);
  }

  private plays(): TriggerPlay[] {
    return [...this.trig].map(([trigger, v]) => ({ trigger, step: v.done, t: this.trigClock?.trigger === trigger ? this.trigClock.t : 0 })).filter((p) => p.step > 0 || p.t > 0);
  }

  /** A click or the right arrow: the next animation, or the next slide when the slide is built. */
  async next(): Promise<void> {
    if (this.stopped) return;
    if (this.inTransition) {
      // a click while a transition plays goes straight on to the next slide
      const to = this.neighbour(1);
      if (to !== null) return this.goto(to, { forward: true });
    }
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
    if (this.h.order?.length) return this.h.order[0]!;
    for (let i = this.lo(); i <= this.hi(); i++) if (!this.h.hidden?.[i]) return i;
    return this.lo();
  }

  /** The next shown slide in a direction, or null at the end. */
  private neighbour(dir: 1 | -1): number | null {
    if (this.h.order?.length) {
      const at = this.h.order.indexOf(this.index);
      return this.h.order[at + dir] ?? null;
    }
    for (let i = this.index + dir; i >= this.lo() && i <= this.hi(); i += dir) if (!this.h.hidden?.[i]) return i;
    return null;
  }

  async prev(): Promise<void> {
    if (this.stopped) return;
    if (this.inTransition) {
      const to = this.neighbour(-1);
      if (to !== null) return this.goto(to, { built: true });
    }
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

  /** A frame of the prepared transition, drawn on every screen at that screen's size. */
  private async cachedFrame(t: number, gen: number): Promise<boolean> {
    const r = await this.h.call(() => this.h.session.transitionFrame(Math.min(1, Math.max(0, t))));
    if (!r || gen !== this.gen) return false;
    const src = (this.scratch ??= document.createElement("canvas"));
    src.width = r.width;
    src.height = r.height;
    const px = new Uint8ClampedArray(r.rgba.buffer as ArrayBuffer, r.rgba.byteOffset, r.rgba.byteLength);
    src.getContext("2d")?.putImageData(new ImageData(px, r.width, r.height), 0, 0);
    for (const s of this.h.surfaces()) {
      const z = s.size();
      const k = Math.min(z.w / this.h.slideW, z.h / this.h.slideH);
      const w = Math.max(1, Math.round(this.h.slideW * k * s.dpr));
      const h = Math.max(1, Math.round(this.h.slideH * k * s.dpr));
      if (s.canvas.width !== w || s.canvas.height !== h) {
        s.canvas.width = w;
        s.canvas.height = h;
      }
      s.canvas.getContext("2d")?.drawImage(src, 0, 0, w, h);
      s.canvas.style.width = `${w / s.dpr}px`;
      s.canvas.style.height = `${h / s.dpr}px`;
    }
    return true;
  }

  private async frame(kind: "tr" | "step", index: number, a: number, t: number, gen: number): Promise<boolean> {
    for (const s of this.h.surfaces()) {
      const { w, h } = s.size();
      const scale = Math.max(0.05, Math.min(w / this.h.slideW, h / this.h.slideH)) * s.dpr;
      const r = await this.h.call(() => (kind === "tr" ? this.h.session.renderTransition(index, Math.min(1, Math.max(0, t)), scale) : this.h.session.renderShow(index, a, t, this.plays(), scale)));
      if (!r || gen !== this.gen) return false;
      paint(s.canvas, r, s.dpr);
    }
    return true;
  }
}
