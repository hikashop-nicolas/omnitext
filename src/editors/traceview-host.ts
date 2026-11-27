import { open, type TraceViewHandle, type ZoomState } from "traceview";
import type { EditorInstance, EditorMountContext } from "../core/types";
import { getLocale, t } from "../i18n";

// Mounts traceview's trace or profile view as an Omnitext editor: the app's theme colours and
// locale go in, and its status bar zoom slider drives the view's zoom.

// Zoom slider steps: the level goes up exponentially along the slider.
const ZOOM_STEPS = 1000;

const THEME_VARS =
  "--tv-canvas:var(--canvas);--tv-chrome:var(--chrome);--tv-bg:var(--bg);--tv-surface:var(--surface);--tv-border:var(--border);" +
  "--tv-text:var(--text);--tv-muted:var(--muted);--tv-accent:var(--accent);--tv-warn:var(--amber);--tv-shadow:var(--shadow)";

function appTheme(): "light" | "dark" | "auto" {
  const theme = document.documentElement.dataset.theme;
  return theme === "dark" || theme === "light" ? theme : "auto";
}

export class TraceViewInstance implements EditorInstance {
  private handle: TraceViewHandle | null = null;
  private root: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private range: HTMLInputElement | null = null;
  private pct: HTMLElement | null = null;
  private zoom: ZoomState = { level: 1, max: 1, enabled: false };
  // A text file hands its text back: the host remounts from getText() (on a theme change, say).
  private text = "";

  constructor(private readonly view: "trace" | "profile") {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.buildBar();
    const root = document.createElement("div");
    root.style.cssText = `height:100%;${THEME_VARS}`;
    container.appendChild(root);
    this.root = root;
    this.text = ctx.binary ? "" : ctx.text;
    const input = ctx.binary
      ? { ...(ctx.bytes ? { bytes: ctx.bytes } : {}), ...(ctx.blob ? { blob: ctx.blob } : {}), name: ctx.filename ?? "" }
      : { text: ctx.text, name: ctx.filename ?? "" };
    this.handle = open(root, input, {
      view: this.view,
      locale: getLocale(),
      theme: appTheme(),
      onZoom: (z) => this.showZoom(z),
      onError: (e) => console.error(`${this.view} not read`, e),
    });
  }

  /** A zoom slider, in the app's status bar as the other viewers have them. */
  private buildBar(): void {
    const ns = this.view === "trace" ? "perfetto" : "profile";
    const label = t(`${ns}.zoom`);
    const bar = document.createElement("div");
    bar.className = "cm-statusbar";
    const grow = document.createElement("span");
    grow.className = "cm-statusbar-grow";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = String(ZOOM_STEPS);
    range.step = "1";
    range.value = "0";
    range.title = label;
    range.setAttribute("aria-label", label);
    range.addEventListener("input", () => this.handle?.setZoom(Math.pow(this.zoom.max, Number(range.value) / ZOOM_STEPS)));
    const pct = document.createElement("span");
    pct.className = "cm-statusbar-pct";
    pct.setAttribute("aria-label", t(`${ns}.zoomLevel`));
    bar.append(grow, range, pct);
    this.bar = bar;
    this.range = range;
    this.pct = pct;
    this.showZoom(this.zoom);
  }

  /** The slider and readout follow the view, whatever moved it (wheel, pinch, keys, a match). */
  private showZoom(z: ZoomState): void {
    this.zoom = z;
    const range = this.range;
    const pct = this.pct;
    if (!range || !pct) return;
    range.disabled = !z.enabled;
    pct.style.visibility = z.enabled ? "" : "hidden";
    if (!z.enabled) return;
    const level = Math.max(1, z.level);
    range.value = String(z.max > 1 ? Math.round((Math.log(level) / Math.log(z.max)) * ZOOM_STEPS) : 0);
    const text = new Intl.NumberFormat(getLocale(), { notation: "compact", maximumFractionDigits: z.level < 10 ? 1 : 0 }).format(z.level);
    pct.textContent = `×${text}`;
    range.setAttribute("aria-valuetext", `×${text}`);
  }

  statusItems(): HTMLElement | null {
    return this.bar;
  }
  getText(): string {
    return this.text;
  }
  selection(): unknown {
    return null;
  }
  focus(): void {
    this.handle?.focus();
  }
  dispose(): void {
    this.handle?.destroy();
    this.handle = null;
    this.bar?.remove();
    this.bar = null;
    this.root?.remove();
    this.root = null;
  }
}
