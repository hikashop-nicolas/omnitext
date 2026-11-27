import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { getLocale, t } from "../i18n";
import { sniffProfileBytes } from "../core/sniff-profile";
import { textProfileKind, type ProfileKind } from "../formats/profile-detect";
import {
  baseName,
  callTree,
  callersOf,
  frameTotals,
  groupByLabel,
  profileSpan,
  stackWeights,
  threadTotals,
  timeHistogram,
  type CallTree,
  type Profile,
  type ProfileThread,
  type SampleFilter,
  type ValueType,
} from "./profile-model";
import { FlameGraph, frameColor, isDark } from "./profile-flame";
import { TimeStrip } from "./profile-strip";

// Read-only profile viewer: where the time went, as a flame graph, a call tree and a table of
// functions, for every profile format the readers turn into the shared model.

const STYLE_ID = "omnitext-profile-style";
const ROW_CAP = 2000;
const ZOOM_STEPS = 1000;

type Tab = "flame" | "tree" | "functions" | "markers";
type Sort = "total" | "self" | "name";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-prof { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--canvas);
      color:var(--text); font:13px system-ui, sans-serif; }
    .ot-prof-head { flex:0 0 auto; padding:6px 16px; border-bottom:1px solid var(--border); background:var(--chrome);
      color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ot-prof-notes { flex:0 0 auto; padding:0 16px; }
    .ot-prof-notes p { margin:6px 0; color:var(--muted); overflow-wrap:anywhere; }
    .ot-prof-notes p.warn { color:var(--amber); }
    .ot-prof-tabs { flex:0 0 auto; display:flex; gap:2px; padding:0 12px; border-bottom:1px solid var(--border);
      overflow-x:auto; background:var(--canvas); }
    .ot-prof-tab { font:inherit; padding:8px 12px; border:0; border-bottom:2px solid transparent; background:none;
      color:var(--muted); cursor:pointer; white-space:nowrap; }
    .ot-prof-tab[aria-selected="true"] { color:var(--text); border-bottom-color:var(--accent); }
    .ot-prof-tools { flex:0 0 auto; display:flex; flex-wrap:wrap; gap:6px 8px; align-items:center; padding:6px 12px;
      border-bottom:1px solid var(--border); }
    .ot-prof-tools select, .ot-prof-tools input[type=search] { font:inherit; padding:4px 8px; border:1px solid var(--border);
      border-radius:6px; background:var(--bg); color:var(--text); min-width:0; max-width:100%; }
    .ot-prof-tools select { flex:0 1 auto; max-width:min(320px, 100%); }
    .ot-prof-tools input[type=search] { flex:1 1 160px; }
    .ot-prof-tools label.check { display:inline-flex; gap:6px; align-items:center; white-space:nowrap; cursor:pointer; }
    .ot-prof-count { color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
    .ot-prof-help { color:var(--muted); font-size:12px; flex:1 1 100%; }
    .ot-prof-tab:focus-visible, .ot-prof-btn:focus-visible, .ot-fg-canvas:focus-visible, .ot-prof-strip canvas:focus-visible,
      .ot-prof tr[tabindex]:focus-visible, .ot-prof th button:focus-visible, .ot-prof-tools label.check:focus-within {
      outline:2px solid var(--accent); outline-offset:-2px; }
    .ot-prof-strip { flex:0 0 auto; position:relative; border-bottom:1px solid var(--border); }
    .ot-prof-strip canvas { display:block; width:100%; height:44px; cursor:crosshair; }
    .ot-prof-strip-label { position:absolute; right:8px; top:2px; font-size:11px; color:var(--muted); pointer-events:none;
      background:color-mix(in srgb, var(--canvas) 80%, transparent); padding:0 4px; border-radius:4px; }
    .ot-prof-panel { flex:1 1 auto; min-height:0; overflow:auto; padding:0 12px 16px; position:relative; }
    .ot-prof-panel.is-flame { display:flex; flex-direction:column; overflow:hidden; padding:0; }
    .ot-prof-panel[hidden] { display:none; }
    .ot-fg { position:relative; flex:1 1 auto; min-height:0; display:flex; }
    .ot-fg-scroll { flex:1 1 auto; overflow-y:auto; overflow-x:hidden; position:relative; }
    .ot-fg-spacer { position:relative; }
    .ot-fg-canvas { position:sticky; top:0; display:block; }
    .ot-fg-tip { position:absolute; z-index:3; pointer-events:none; max-width:420px; padding:4px 8px; border-radius:6px;
      background:var(--text); color:var(--canvas); font:12px/1.4 system-ui, sans-serif; white-space:pre-wrap;
      overflow-wrap:anywhere; box-shadow:var(--shadow); }
    .ot-prof-details { flex:0 0 auto; min-height:2.8em; max-height:30%; overflow:auto; padding:6px 12px; border-top:1px solid var(--border);
      background:var(--chrome); font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere; }
    .ot-prof-legend { display:flex; flex-wrap:wrap; gap:4px 12px; padding:4px 12px; font-size:12px; color:var(--muted);
      border-bottom:1px solid var(--border); }
    .ot-prof-legend span::before { content:""; display:inline-block; width:10px; height:10px; border-radius:2px;
      margin-right:4px; vertical-align:-1px; background:var(--sw); }
    .ot-prof-legend[hidden] { display:none; }
    .ot-prof table { border-collapse:collapse; font:12px/1.4 ui-monospace, monospace; width:100%; }
    .ot-prof th, .ot-prof td { border-bottom:1px solid var(--border); padding:3px 10px 3px 0; text-align:left; vertical-align:top; }
    .ot-prof thead th { position:sticky; top:0; background:var(--canvas); z-index:1; font:600 12px system-ui, sans-serif; }
    .ot-prof th button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }
    .ot-prof th[aria-sort] button::after { content:" ▾"; }
    .ot-prof th[aria-sort="ascending"] button::after { content:" ▴"; }
    .ot-prof td.num, .ot-prof th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .ot-prof td.fn { overflow-wrap:anywhere; min-width:200px; }
    .ot-prof td.mod { color:var(--muted); overflow-wrap:anywhere; }
    .ot-prof tr[tabindex] { cursor:default; }
    .ot-prof tr[tabindex]:hover td { background:var(--surface); }
    .ot-prof tr.hit td.fn { color:var(--accent); font-weight:600; }
    .ot-prof .tw { display:inline-block; width:1.2em; color:var(--muted); }
    .ot-prof tr.sub td { color:var(--muted); }
    .ot-prof-empty { color:var(--muted); padding:12px 0; }
    .ot-prof-msg { margin:auto; color:var(--muted); padding:24px; text-align:center; white-space:pre-wrap; }
    .ot-prof [hidden] { display:none !important; }
    .ot-prof-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width: 600px) {
      .ot-prof-help { display:none; }
      .ot-prof td.mod, .ot-prof th.mod, .ot-prof .pct2 { display:none; }
      .ot-prof td.fn { min-width:140px; }
      .ot-prof-panel { padding:0 8px 16px; }
      .ot-prof-tools { padding:6px 8px; }
    }
  `;
  document.head.appendChild(s);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A module cell: the file name, with the whole path on hover. */
function modCell(module: string): HTMLTableCellElement {
  const td = el("td", "mod", baseName(module));
  if (module && td.textContent !== module) td.title = module;
  return td;
}

function fmtUnit(value: number, u: string, digits = 1): string {
  try {
    return new Intl.NumberFormat(getLocale(), { style: "unit", unit: u, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${u}`;
  }
}

/** A duration in ns, in the unit that reads best. */
export function duration(ns: number): string {
  const a = Math.abs(ns);
  if (a < 1e3) return fmtUnit(ns, "nanosecond", 0);
  if (a < 1e6) return fmtUnit(ns / 1e3, "microsecond", 1);
  if (a < 1e9) return fmtUnit(ns / 1e6, "millisecond", a < 1e7 ? 2 : 1);
  if (a < 120e9) return fmtUnit(ns / 1e9, "second", 2);
  return fmtUnit(ns / 60e9, "minute", 1);
}

function bytes(n: number): string {
  const a = Math.abs(n);
  if (a < 1024) return fmtUnit(n, "byte", 0);
  if (a < 1048576) return fmtUnit(n / 1024, "kilobyte", 1);
  if (a < 1073741824) return fmtUnit(n / 1048576, "megabyte", 1);
  return fmtUnit(n / 1073741824, "gigabyte", 2);
}

const TIME_SCALE: Record<string, number> = { nanoseconds: 1, ns: 1, microseconds: 1e3, us: 1e3, milliseconds: 1e6, ms: 1e6, seconds: 1e9, s: 1e9 };

/** A weight in its value type's unit. */
export function formatValue(v: number, vt: ValueType): string {
  const u = vt.unit.toLowerCase();
  if (TIME_SCALE[u] !== undefined) return duration(v * TIME_SCALE[u]!);
  if (u === "bytes" || u === "byte") return bytes(v);
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: v < 100 ? 2 : 0 }).format(v);
}

function pct(part: number, whole: number): string {
  if (!(whole > 0)) return "";
  const r = part / whole;
  const f = new Intl.NumberFormat(getLocale(), { style: "percent", maximumFractionDigits: r < 0.1 ? 2 : 1 });
  // A sliver still shows as something, not as 0%.
  return r > 0 && r < 0.0001 ? `< ${f.format(0.0001)}` : f.format(r);
}

/** A thread's name, or a translated one for threads the file leaves unnamed. */
function threadName(th: ProfileThread): string {
  if (th.name) return th.name;
  return th.tid !== undefined ? t("profile.unnamedThread", { id: String(th.tid) }) : t("profile.mainThread");
}

// The categories the readers name themselves; others come from the file and stay as written.
const CATEGORY_KEYS: Record<string, string> = { Kernel: "catKernel", Native: "catNative", GC: "catGc", Idle: "catIdle", Inlined: "catInlined", Other: "catOther" };

function catName(cat: string): string {
  if (!cat) return t("profile.uncategorized");
  const key = CATEGORY_KEYS[cat];
  return key ? t(`profile.${key}`) : cat;
}

function valueName(vt: ValueType): string {
  switch (vt.label) {
    case "samples":
      return t("profile.valueSamples");
    case "time":
      return t("profile.valueTime");
    case "bytes":
      return t("profile.valueBytes");
    case "weight":
      return t("profile.valueWeight");
    case "period":
      return t("profile.valuePeriod", { event: vt.type });
    case "events":
      return t("profile.valueEvents", { event: vt.type });
  }
  return vt.unit && vt.unit !== "count" ? `${vt.type} (${vt.unit})` : vt.type;
}

const FORMAT_KEYS: Record<ProfileKind, string> = {
  collapsed: "profile.formatCollapsed",
  perfscript: "profile.formatPerf",
  gecko: "profile.formatGecko",
  cpuprofile: "profile.formatCpuprofile",
  chrometrace: "profile.formatChrome",
  speedscope: "profile.formatSpeedscope",
  pprof: "profile.formatPprof",
  simpleperf: "profile.formatSimpleperf",
};

async function readProfile(kind: ProfileKind, ctx: EditorMountContext): Promise<Profile> {
  if (kind === "pprof" || kind === "simpleperf") {
    const proto = await import("./profile-read-proto");
    return kind === "pprof" ? proto.readPprof(ctx.bytes!) : proto.readSimpleperf(ctx.bytes!);
  }
  if (kind === "collapsed" || kind === "perfscript") {
    const text = await import("./profile-read-text");
    return kind === "collapsed" ? text.readCollapsed(ctx.text) : text.readPerfScript(ctx.text);
  }
  const json = await import("./profile-read-json");
  if (kind === "gecko") return json.readGecko(ctx.text);
  if (kind === "cpuprofile") return json.readCpuProfile(ctx.text);
  if (kind === "speedscope") return json.readSpeedscope(ctx.text);
  return json.readChromeTraceProfiles(ctx.text);
}

class ProfileInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private disposed = false;
  private text = "";
  private bar: HTMLElement | null = null;
  private zoomRange: HTMLInputElement | null = null;
  private zoomPct: HTMLElement | null = null;
  private flame: FlameGraph | null = null;
  private strip: TimeStrip | null = null;
  // The profile as read, and as grouped (by thread or by a label).
  private base: Profile | null = null;
  private p: Profile | null = null;
  private filter: SampleFilter = { threads: null, value: 0 };
  private weights: Float64Array = new Float64Array(0);
  private tree: CallTree | null = null;
  private inverted = false;
  private colorMode: "module" | "category" = "module";
  private query = "";
  private match: Uint8Array | null = null;
  private tab: Tab = "flame";
  private sort: Sort = "total";
  private expanded = new Set<string>();
  private fnExpanded = new Set<number>();
  private totals: { self: Float64Array; total: Float64Array } | null = null;
  private panels: Record<Tab, HTMLElement> | null = null;
  private live: HTMLElement | null = null;
  private legend: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private threadSel: HTMLSelectElement | null = null;
  private colorSel: HTMLSelectElement | null = null;
  private invertBox: HTMLLabelElement | null = null;
  private markerQuery = "";
  private pending = 0;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.buildBar();
    const root = el("div", "ot-prof");
    container.appendChild(root);
    this.root = root;
    this.text = ctx.binary ? "" : ctx.text;
    const msg = el("div", "ot-prof-msg", t("profile.reading"));
    root.appendChild(msg);
    const kind: ProfileKind | null = ctx.binary && ctx.bytes ? ((sniffProfileBytes(ctx.bytes) as ProfileKind | null) ?? "pprof") : textProfileKind(ctx.text);
    // Let the message paint before a large file is read.
    void new Promise((r) => setTimeout(r, 30))
      .then(() => (kind ? readProfile(kind, ctx) : null))
      .then((p) => {
        if (this.disposed) return;
        root.textContent = "";
        if (!p || !kind || !p.sampleStack.length) {
          root.append(el("div", "ot-prof-msg", t(kind === "chrometrace" ? "profile.noCpuProfile" : "profile.notProfile")));
          return;
        }
        this.render(root, kind, p, ctx.bytes?.length ?? ctx.text.length);
      })
      .catch((e: unknown) => {
        if (this.disposed) return;
        console.error("profile not read", e);
        msg.textContent = t("profile.failed", { error: (e as Error)?.message ?? String(e) });
      });
  }

  // --- layout -------------------------------------------------------------------------------

  private render(root: HTMLElement, kind: ProfileKind, p: Profile, size: number): void {
    this.base = p;
    this.p = p;
    this.filter = { threads: null, value: this.firstValue(p, p.defaultValue) };
    const span = profileSpan(p);
    const head = [t(FORMAT_KEYS[kind]), t("profile.samples", { count: p.sampleStack.length, n: p.sampleStack.length.toLocaleString(getLocale()) })];
    if (p.threads.length > 1) head.push(t("profile.threads", { count: p.threads.length, n: p.threads.length.toLocaleString(getLocale()) }));
    if (span > 0) head.push(duration(span));
    else if (p.duration) head.push(duration(p.duration));
    head.push(size < 1048576 ? fmtUnit(size / 1024, "kilobyte", 1) : fmtUnit(size / 1048576, "megabyte", 1));
    root.append(el("div", "ot-prof-head", head.join(" · ")));
    const notes = this.notes(p);
    if (notes) root.append(notes);

    const tabs = el("div", "ot-prof-tabs");
    tabs.setAttribute("role", "tablist");
    const list: [Tab, string][] = [
      ["flame", t("profile.tabFlame")],
      ["tree", t("profile.tabTree")],
      ["functions", t("profile.tabFunctions")],
    ];
    if (p.markers.length) list.push(["markers", t("profile.tabMarkers", { n: p.markers.length.toLocaleString(getLocale()) })]);
    const buttons: HTMLButtonElement[] = [];
    for (const [id, label] of list) {
      const b = el("button", "ot-prof-tab", label);
      b.type = "button";
      b.dataset.tab = id;
      b.id = `ot-prof-tab-${id}`;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", `ot-prof-panel-${id}`);
      b.addEventListener("click", () => this.show(id));
      buttons.push(b);
      tabs.append(b);
    }
    tabs.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]!;
      next.focus();
      next.click();
      e.preventDefault();
    });
    root.append(tabs, this.toolbar(p));
    // The legend for category colours, when that is the colouring.
    const legend = el("div", "ot-prof-legend");
    legend.hidden = true;
    this.legend = legend;
    root.append(legend);
    if (p.sampleTime && span > 0) this.buildStrip(root, p, span);

    const mk = (id: Tab, cls = "") => {
      const panel = el("div", `ot-prof-panel ${cls}`.trim());
      panel.id = `ot-prof-panel-${id}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `ot-prof-tab-${id}`);
      panel.hidden = true;
      root.append(panel);
      return panel;
    };
    this.panels = { flame: mk("flame", "is-flame"), tree: mk("tree"), functions: mk("functions"), markers: mk("markers") };
    this.buildFlame(this.panels.flame);
    const live = el("div", "ot-prof-sr");
    live.setAttribute("aria-live", "polite");
    this.live = live;
    root.append(live);
    this.recompute();
    this.show("flame");
    // Tabs keep their selected state.
    const sync = () =>
      buttons.forEach((b) => {
        const on = b.dataset.tab === this.tab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
    this.afterShow = sync;
    sync();
  }

  private afterShow: (() => void) | null = null;

  private notes(p: Profile): HTMLElement | null {
    const out = el("div", "ot-prof-notes");
    const labels: string[] = [];
    for (const n of p.notes) {
      const [k, ...rest] = n.split(":");
      const v = rest.join(":");
      if (k === "skipped") out.append(el("p", "warn", t("profile.skipped", { n: Number(v).toLocaleString(getLocale()) })));
      else if (k === "lost") out.append(el("p", "warn", t("profile.lost", { n: Number(v).toLocaleString(getLocale()) })));
      else if (k === "comment") out.append(el("p", "", t("profile.comment", { text: v })));
      else if (k === "app") out.append(el("p", "", t("profile.app", { name: v })));
      else if (k === "label") labels.push(v);
    }
    if (p.labels?.keys.length) labels.push(...p.labels.keys);
    if (labels.length) out.append(el("p", "", t("profile.labels", { list: [...new Set(labels)].join(", ") })));
    return out.childElementCount ? out : null;
  }

  /** The first value type with weight, starting from the preferred one. */
  private firstValue(p: Profile, preferred: number): number {
    const sum = (k: number) => {
      let s = 0;
      for (const v of p.values[k] ?? []) s += Math.abs(v);
      return s;
    };
    if (sum(preferred) > 0) return preferred;
    for (let k = 0; k < p.valueTypes.length; k++) if (sum(k) > 0) return k;
    return preferred;
  }

  private toolbar(p: Profile): HTMLElement {
    const tools = el("div", "ot-prof-tools");
    // Group by: threads, or one of pprof's sample labels.
    if (p.labels?.keys.length) {
      const g = el("select");
      g.setAttribute("aria-label", t("profile.groupBy"));
      g.title = t("profile.groupBy");
      g.append(new Option(t("profile.groupThreads"), "-1"));
      p.labels.keys.forEach((k, i) => g.append(new Option(t("profile.groupLabel", { key: k }), String(i))));
      g.addEventListener("change", () => {
        const k = Number(g.value);
        this.p = k < 0 ? this.base! : groupByLabel(this.base!, k, t("profile.noLabel"));
        this.filter.threads = null;
        this.fillThreads();
        this.recompute(true);
      });
      tools.append(g);
    }
    const th = el("select");
    th.setAttribute("aria-label", t("profile.thread"));
    th.title = t("profile.thread");
    th.addEventListener("change", () => {
      const v = th.value;
      if (v === "all") this.filter.threads = null;
      else if (v.startsWith("p:")) {
        const pid = v.slice(2);
        this.filter.threads = new Set(this.p!.threads.flatMap((x, i) => (String(x.pid) === pid ? [i] : [])));
      } else this.filter.threads = new Set([Number(v)]);
      this.recompute(true);
    });
    this.threadSel = th;
    tools.append(th);
    this.fillThreads();
    if (p.valueTypes.length > 1) {
      const vs = el("select");
      vs.setAttribute("aria-label", t("profile.value"));
      vs.title = t("profile.value");
      p.valueTypes.forEach((vt, i) => vs.append(new Option(valueName(vt), String(i))));
      vs.value = String(this.filter.value);
      vs.addEventListener("change", () => {
        this.filter.value = Number(vs.value);
        this.fillThreads();
        this.recompute(true);
      });
      tools.append(vs);
    }
    const cs = el("select");
    cs.setAttribute("aria-label", t("profile.colorBy"));
    cs.title = t("profile.colorBy");
    cs.append(new Option(t("profile.colorModule"), "module"), new Option(t("profile.colorCategory"), "category"));
    // Profiles mixing several categories (kernel and user, Java and native) open coloured by them.
    if (new Set(p.frames.map((f) => f.category).filter(Boolean)).size >= 2) this.colorMode = "category";
    cs.value = this.colorMode;
    cs.addEventListener("change", () => {
      this.colorMode = cs.value as "module" | "category";
      this.flame?.setColorMode(this.colorMode);
      this.showLegend();
    });
    this.colorSel = cs;
    const inv = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.addEventListener("change", () => {
      this.inverted = box.checked;
      this.recompute();
    });
    inv.append(box, document.createTextNode(t("profile.inverted")));
    inv.title = t("profile.invertedHint");
    this.invertBox = inv;
    const search = el("input");
    search.type = "search";
    search.placeholder = t("profile.search");
    search.setAttribute("aria-label", t("profile.search"));
    search.addEventListener("input", () => {
      window.clearTimeout(this.pending);
      this.pending = window.setTimeout(() => {
        this.query = search.value.trim().toLowerCase();
        this.applySearch();
        this.renderTab();
      }, 150);
    });
    const count = el("span", "ot-prof-count");
    count.setAttribute("aria-live", "polite");
    this.countEl = count;
    const help = el("div", "ot-prof-help", t("profile.flameHelp"));
    help.dataset.for = "flame";
    tools.append(cs, inv, search, count, help);
    return tools;
  }

  /** The thread list, heaviest first, grouped by process, with each one's share. */
  private fillThreads(): void {
    const sel = this.threadSel;
    const p = this.p;
    if (!sel || !p) return;
    const tot = threadTotals(p, this.filter.value);
    let all = 0;
    for (const v of tot) all += v;
    sel.textContent = "";
    sel.append(new Option(t("profile.allThreads"), "all"));
    const order = [...tot.keys()].filter((i) => tot[i]! > 0).sort((a, b) => tot[b]! - tot[a]!);
    const vt = p.valueTypes[this.filter.value]!;
    const label = (i: number) => {
      const th = p.threads[i]!;
      const name = threadName(th);
      const id = th.tid !== undefined && String(th.tid) !== name ? ` ${th.tid}` : "";
      return `${name}${id} · ${pct(tot[i]!, all)} · ${formatValue(tot[i]!, vt)}`;
    };
    const procs = new Map<string, number[]>();
    for (const i of order) {
      const key = p.threads[i]!.pid !== undefined ? String(p.threads[i]!.pid) : "";
      if (!procs.has(key)) procs.set(key, []);
      procs.get(key)!.push(i);
    }
    const grouped = procs.size > 1 || (procs.size === 1 && !procs.has("") && order.length > 1);
    for (const [pid, threads] of procs) {
      if (!grouped || !pid) {
        for (const i of threads) sel.append(new Option(label(i), String(i)));
        continue;
      }
      // Some tools name the process by its whole command line.
      const full = p.threads[threads[0]!]!.process || pid;
      const name = full.length > 48 ? `${full.slice(0, 47)}…` : full;
      const sum = threads.reduce((a, i) => a + tot[i]!, 0);
      const og = el("optgroup");
      og.label = `${name} (${pid})`;
      if (threads.length > 1) og.append(new Option(t("profile.wholeProcess", { name, share: pct(sum, all) }), `p:${pid}`));
      for (const i of threads) og.append(new Option(label(i), String(i)));
      sel.append(og);
    }
    sel.hidden = order.length <= 1;
    const f = this.filter.threads;
    sel.value = !f ? "all" : f.size === 1 ? String([...f][0]) : sel.value;
  }

  private buildStrip(root: HTMLElement, p: Profile, span: number): void {
    const strip = new TimeStrip(root, span, {
      aria: t("profile.strip"),
      range: (a, b) => t("profile.range", { from: duration(a), to: duration(b), dur: duration(b - a) }),
      all: t("profile.stripAll"),
      time: duration,
    });
    this.strip = strip;
    strip.onWidth = () => this.refreshStrip();
    strip.onRange = (r) => {
      this.filter.from = r ? r[0] : NaN;
      this.filter.to = r ? r[1] : NaN;
      this.recompute(true);
    };
    if (p.markers.length) {
      const dark = isDark();
      strip.setMarkers(p.markers.slice(0, 20000).map((m) => ({ start: m.start, dur: m.dur, color: frameColor({ name: m.name, module: "", category: m.category }, "category", dark) })));
    }
  }

  private refreshStrip(): void {
    const s = this.strip;
    const p = this.p;
    if (!s || !p) return;
    s.setBins(timeHistogram(p, { threads: this.filter.threads, value: this.filter.value }, s.columns(), profileSpan(p)));
  }

  private buildFlame(panel: HTMLElement): void {
    const host = el("div");
    host.style.cssText = "flex:1 1 auto;min-height:0;display:flex;position:relative";
    const details = el("div", "ot-prof-details", t("profile.focusHint"));
    panel.append(host, details);
    const fg = new FlameGraph(host, {
      aria: t("profile.flameAria"),
      all: t("profile.all"),
      describe: (n) => this.describe(n),
    });
    fg.onView = () => this.showZoom();
    fg.onFocus = (n, announce) => {
      const text = n >= 0 ? this.describe(n) : t("profile.focusHint");
      details.textContent = text;
      if (announce && this.live) this.live.textContent = text;
    };
    this.flame = fg;
  }

  private show(tab: Tab): void {
    if (!this.panels) return;
    this.tab = tab;
    for (const [id, panel] of Object.entries(this.panels)) panel.hidden = id !== tab;
    this.enableZoom(tab === "flame");
    if (this.colorSel) this.colorSel.hidden = tab !== "flame";
    if (this.invertBox) this.invertBox.hidden = tab === "functions" || tab === "markers";
    const help = this.root?.querySelector<HTMLElement>(".ot-prof-help");
    if (help) help.hidden = tab !== "flame";
    this.showLegend();
    this.afterShow?.();
    this.renderTab();
  }

  private showLegend(): void {
    const lg = this.legend;
    const p = this.p;
    if (!lg || !p) return;
    lg.hidden = this.tab !== "flame" || this.colorMode !== "category";
    if (lg.hidden) return;
    // The categories that carry weight, heaviest first.
    const w = new Map<string, number>();
    const totals = this.frameTotals();
    p.frames.forEach((f, i) => w.set(f.category, (w.get(f.category) ?? 0) + totals.self[i]!));
    const dark = isDark();
    lg.textContent = "";
    for (const [cat] of [...w].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      const s = el("span", "", catName(cat));
      s.style.setProperty("--sw", frameColor({ name: "", module: "", category: cat }, "category", dark));
      lg.append(s);
    }
  }

  // --- data -----------------------------------------------------------------------------------

  /** Samples or grouping changed: weights, tree and every view follow. */
  private recompute(keepZoom = false): void {
    const p = this.p;
    if (!p) return;
    this.weights = stackWeights(p, this.filter);
    this.tree = callTree(p, this.weights, this.inverted);
    this.totals = null;
    this.fnExpanded.clear();
    this.flame?.setTree(this.tree, p.frames, keepZoom);
    this.flame?.setColorMode(this.colorMode);
    this.applySearch();
    this.refreshStrip();
    this.showLegend();
    this.renderTab();
    this.showZoom();
  }

  private frameTotals(): { self: Float64Array; total: Float64Array } {
    if (!this.totals) this.totals = frameTotals(this.p!, this.weights);
    return this.totals;
  }

  private applySearch(): void {
    const p = this.p;
    if (!p) return;
    const q = this.query;
    if (!q) {
      this.match = null;
      this.flame?.setMatches(null);
      if (this.countEl) this.countEl.textContent = "";
      return;
    }
    const m = new Uint8Array(p.frames.length);
    p.frames.forEach((f, i) => {
      if (f.name.toLowerCase().includes(q) || f.module.toLowerCase().includes(q)) m[i] = 1;
    });
    this.match = m;
    this.flame?.setMatches(m);
    // Weight of the samples with a matching frame anywhere on their stack.
    const S = p.stackFrame.length;
    const has = new Uint8Array(S);
    let hit = 0;
    let all = 0;
    for (let s = 0; s < S; s++) {
      const parent = p.stackParent[s]!;
      has[s] = m[p.stackFrame[s]!]! || (parent >= 0 ? has[parent]! : 0);
      all += this.weights[s]!;
      if (has[s]) hit += this.weights[s]!;
    }
    if (this.countEl) this.countEl.textContent = hit > 0 ? t("profile.matches", { percent: pct(hit, all) }) : t("profile.noMatch");
  }

  /** Hover and focus text: the frame, where it lives, its total and self weight. */
  private describe(n: number): string {
    const tr = this.tree;
    const p = this.p;
    if (!tr || !p) return "";
    const vt = p.valueTypes[this.filter.value]!;
    const all = tr.total[0]!;
    if (n === 0) return `${t("profile.all")}\n${t("profile.describeTotal", { value: formatValue(all, vt), percent: pct(all, all) })}`;
    const f = p.frames[tr.frame[n]!]!;
    const where = [f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : f.module, f.category ? catName(f.category) : ""].filter(Boolean).join(" · ");
    const lines = [f.name];
    if (where) lines.push(where);
    const tot = t("profile.describeTotal", { value: formatValue(tr.total[n]!, vt), percent: pct(tr.total[n]!, all) });
    const self = tr.self[n]! > 0 ? t("profile.describeSelf", { value: formatValue(tr.self[n]!, vt), percent: pct(tr.self[n]!, all) }) : "";
    lines.push(self ? `${tot} · ${self}` : tot);
    return lines.join("\n");
  }

  // --- tabs -----------------------------------------------------------------------------------

  private renderTab(): void {
    if (!this.panels || !this.p) return;
    if (this.tab === "flame") {
      this.flame?.redraw();
      return;
    }
    const panel = this.panels[this.tab];
    const top = panel.scrollTop;
    panel.textContent = "";
    if (this.tab === "tree") this.callTreeTab(panel);
    else if (this.tab === "functions") this.functionsTab(panel);
    else this.markersTab(panel);
    panel.scrollTop = top;
  }

  private header(cols: [string, string, Sort | null][]): HTMLTableSectionElement {
    const head = el("thead");
    const tr = el("tr");
    for (const [label, cls, key] of cols) {
      const th = el("th", cls);
      th.scope = "col";
      if (key) {
        const b = el("button", "", label);
        b.type = "button";
        b.title = t("profile.sortBy", { column: label });
        b.addEventListener("click", () => {
          this.sort = key;
          this.renderTab();
          this.panels?.[this.tab].querySelector<HTMLButtonElement>(`th[aria-sort] button`)?.focus();
        });
        th.append(b);
        if (this.sort === key) th.setAttribute("aria-sort", key === "name" ? "ascending" : "descending");
      } else th.textContent = label;
      tr.append(th);
    }
    head.append(tr);
    return head;
  }

  private sorted(nodes: Iterable<number>, total: ArrayLike<number>, self: ArrayLike<number>, name: (n: number) => string): number[] {
    const out = [...nodes];
    if (this.sort === "self") out.sort((a, b) => self[b]! - self[a]! || total[b]! - total[a]!);
    else if (this.sort === "name") out.sort((a, b) => name(a).localeCompare(name(b)));
    else out.sort((a, b) => total[b]! - total[a]! || self[b]! - self[a]!);
    return out;
  }

  private callTreeTab(panel: HTMLElement): void {
    const tr = this.tree!;
    const p = this.p!;
    const vt = p.valueTypes[this.filter.value]!;
    const all = tr.total[0]!;
    if (!all) {
      panel.append(el("p", "ot-prof-empty", t("profile.noSamplesHere")));
      return;
    }
    const keyOf = (n: number): string => {
      const parts: number[] = [];
      for (let x = n; x > 0; x = tr.parent[x]!) parts.push(tr.frame[x]!);
      return `${tr.inverted ? "i" : "n"}${parts.reverse().join("/")}`;
    };
    // First view: open the heaviest path while one callee holds most of the time.
    if (![...this.expanded].some((k) => k[0] === (tr.inverted ? "i" : "n"))) {
      let n = 0;
      for (let d = 0; d < 40; d++) {
        const kids = tr.children[n]!;
        if (!kids.length) break;
        const c = kids[0]!;
        if (n > 0 && tr.total[c]! < tr.total[n]! * 0.5) break;
        if (n > 0) this.expanded.add(keyOf(n));
        n = c;
      }
      this.expanded.add(keyOf(n));
    }
    const name = (n: number) => p.frames[tr.frame[n]!]!.name;
    const table = el("table");
    table.setAttribute("role", "treegrid");
    table.setAttribute("aria-label", t("profile.tabTree"));
    table.append(
      this.header([
        [t("profile.total"), "num", "total"],
        ["%", "num pct2", null],
        [t("profile.self"), "num", "self"],
        [t("profile.name"), "", "name"],
        [t("profile.module"), "mod", null],
      ]),
    );
    const body = el("tbody");
    let rows = 0;
    const add = (n: number, level: number) => {
      if (rows >= ROW_CAP) return;
      rows++;
      const f = p.frames[tr.frame[n]!]!;
      const key = keyOf(n);
      const open = this.expanded.has(key);
      const kids = tr.children[n]!;
      const row = el("tr");
      row.tabIndex = -1;
      row.setAttribute("role", "row");
      row.setAttribute("aria-level", String(level));
      if (kids.length) row.setAttribute("aria-expanded", String(open));
      row.dataset.key = key;
      row.dataset.node = String(n);
      if (this.match && this.match[tr.frame[n]!]) row.classList.add("hit");
      const fn = el("td", "fn");
      fn.style.paddingLeft = `${(level - 1) * 12}px`;
      fn.append(el("span", "tw", kids.length ? (open ? "▾" : "▸") : ""), document.createTextNode(f.name));
      row.append(
        el("td", "num", formatValue(tr.total[n]!, vt)),
        el("td", "num pct2", pct(tr.total[n]!, all)),
        el("td", "num", tr.self[n]! > 0 ? formatValue(tr.self[n]!, vt) : ""),
        fn,
        modCell(f.module),
      );
      body.append(row);
      if (open) for (const c of this.sorted(kids, tr.total, tr.self, name)) add(c, level + 1);
    };
    for (const c of this.sorted(tr.children[0]!, tr.total, tr.self, name)) add(c, 1);
    table.append(body);
    panel.append(table);
    if (rows >= ROW_CAP) panel.append(el("p", "ot-prof-empty", t("profile.rowsCapped", { n: ROW_CAP.toLocaleString(getLocale()) })));
    this.treeKeys(body, (row, open) => {
      const key = row.dataset.key!;
      if (open === undefined) open = !this.expanded.has(key);
      if (open) this.expanded.add(key);
      else this.expanded.delete(key);
      this.renderTab();
      this.panels?.tree.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(key)}"]`)?.focus();
    });
    // Double click: the frame in the flame graph.
    body.addEventListener("dblclick", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-node]");
      if (!row) return;
      this.show("flame");
      this.flame?.zoomTo(Number(row.dataset.node));
    });
  }

  /** Treegrid keys: rows move with the arrows, open and close with Right, Left and Enter. */
  private treeKeys(body: HTMLElement, toggle: (row: HTMLElement, open?: boolean) => void): void {
    const rows = () => [...body.querySelectorAll<HTMLElement>("tr[tabindex]")];
    const first = rows()[0];
    if (first) first.tabIndex = 0;
    body.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("tr[tabindex]");
      if (!row) return;
      rows().forEach((r) => (r.tabIndex = -1));
      row.tabIndex = 0;
      if (row.hasAttribute("aria-expanded")) toggle(row);
      else row.focus();
    });
    body.addEventListener("keydown", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("tr[tabindex]");
      if (!row) return;
      const all = rows();
      const i = all.indexOf(row);
      const level = Number(row.getAttribute("aria-level") ?? "1");
      const exp = row.getAttribute("aria-expanded");
      let to: HTMLElement | undefined;
      switch (e.key) {
        case "ArrowDown":
          to = all[i + 1];
          break;
        case "ArrowUp":
          to = all[i - 1];
          break;
        case "Home":
          to = all[0];
          break;
        case "End":
          to = all[all.length - 1];
          break;
        case "ArrowRight":
          if (exp === "false") toggle(row, true);
          else if (exp === "true") to = all[i + 1];
          break;
        case "ArrowLeft":
          if (exp === "true") toggle(row, false);
          else for (let k = i - 1; k >= 0; k--) if (Number(all[k]!.getAttribute("aria-level")) < level) {
            to = all[k];
            break;
          }
          break;
        case "Enter":
        case " ":
          if (exp !== null) toggle(row);
          break;
        default:
          return;
      }
      e.preventDefault();
      if (to) {
        all.forEach((r) => (r.tabIndex = -1));
        to.tabIndex = 0;
        to.focus();
      }
    });
  }

  private functionsTab(panel: HTMLElement): void {
    const p = this.p!;
    const tr = this.tree!;
    const vt = p.valueTypes[this.filter.value]!;
    const all = tr.total[0]!;
    const { self, total } = this.frameTotals();
    let ids = [...total.keys()].filter((f) => total[f]! > 0);
    if (this.match) ids = ids.filter((f) => this.match![f]);
    if (!ids.length) {
      panel.append(el("p", "ot-prof-empty", t(all ? "profile.noMatch" : "profile.noSamplesHere")));
      return;
    }
    const name = (f: number) => p.frames[f]!.name;
    const order = this.sorted(ids, total, self, name).slice(0, ROW_CAP);
    const table = el("table");
    table.setAttribute("role", "treegrid");
    table.setAttribute("aria-label", t("profile.tabFunctions"));
    table.append(
      this.header([
        [t("profile.self"), "num", "self"],
        ["%", "num pct2", null],
        [t("profile.total"), "num", "total"],
        ["%", "num pct2", null],
        [t("profile.name"), "", "name"],
        [t("profile.module"), "mod", null],
      ]),
    );
    const body = el("tbody");
    for (const f of order) {
      const fr = p.frames[f]!;
      const open = this.fnExpanded.has(f);
      const row = el("tr");
      row.tabIndex = -1;
      row.setAttribute("role", "row");
      row.setAttribute("aria-level", "1");
      row.setAttribute("aria-expanded", String(open));
      row.dataset.frame = String(f);
      const fn = el("td", "fn");
      fn.append(el("span", "tw", open ? "▾" : "▸"), document.createTextNode(fr.name));
      row.append(
        el("td", "num", self[f]! > 0 ? formatValue(self[f]!, vt) : ""),
        el("td", "num pct2", self[f]! > 0 ? pct(self[f]!, all) : ""),
        el("td", "num", formatValue(total[f]!, vt)),
        el("td", "num pct2", pct(total[f]!, all)),
        fn,
        el("td", "mod", fr.file ? `${baseName(fr.file)}${fr.line ? `:${fr.line}` : ""}` : baseName(fr.module)),
      );
      body.append(row);
      if (!open) continue;
      // Callers, heaviest first, with the weight that came through each.
      const callers = [...callersOf(p, this.weights, f)].sort((a, b) => b[1] - a[1]).slice(0, 50);
      for (const [c, w] of callers) {
        const sub = el("tr", "sub");
        sub.tabIndex = -1;
        sub.setAttribute("role", "row");
        sub.setAttribute("aria-level", "2");
        const cell = el("td", "fn");
        cell.style.paddingLeft = "1.2em";
        cell.textContent = `← ${c < 0 ? t("profile.noCaller") : p.frames[c]!.name}`;
        sub.append(el("td", "num"), el("td", "num pct2"), el("td", "num", formatValue(w, vt)), el("td", "num pct2", pct(w, all)), cell, modCell(c >= 0 ? p.frames[c]!.module : ""));
        body.append(sub);
      }
    }
    table.append(body);
    panel.append(table);
    if (ids.length > ROW_CAP) panel.append(el("p", "ot-prof-empty", t("profile.rowsCapped", { n: ROW_CAP.toLocaleString(getLocale()) })));
    this.treeKeys(body, (row, open) => {
      const f = Number(row.dataset.frame);
      if (open === undefined) open = !this.fnExpanded.has(f);
      if (open) this.fnExpanded.add(f);
      else this.fnExpanded.delete(f);
      this.renderTab();
      this.panels?.functions.querySelector<HTMLElement>(`tr[data-frame="${f}"]`)?.focus();
    });
  }

  private markersTab(panel: HTMLElement): void {
    const p = this.p!;
    const tools = el("div", "ot-prof-tools");
    tools.style.cssText = "padding:6px 0;border:0";
    const q = el("input");
    q.type = "search";
    q.placeholder = t("profile.filterMarkers");
    q.setAttribute("aria-label", t("profile.filterMarkers"));
    q.value = this.markerQuery;
    tools.append(q);
    if (this.strip) tools.append(el("span", "ot-prof-count", t("profile.markerHint")));
    const host = el("div");
    panel.append(tools, host);
    const draw = () => {
      const needle = this.markerQuery.toLowerCase();
      const list = p.markers.filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.category.toLowerCase().includes(needle) || m.detail.toLowerCase().includes(needle));
      list.sort((a, b) => a.start - b.start);
      const table = el("table");
      table.setAttribute("aria-label", t("profile.tabMarkers", { n: list.length }));
      const head = el("thead");
      const hr = el("tr");
      for (const [label, cls] of [
        [t("profile.markerStart"), "num"],
        [t("profile.markerDuration"), "num"],
        [t("profile.markerName"), ""],
        [t("profile.markerCategory"), "mod"],
        [t("profile.thread"), "mod"],
        [t("profile.markerDetails"), "mod"],
      ] as const) {
        const th = el("th", cls, label);
        th.scope = "col";
        hr.append(th);
      }
      head.append(hr);
      const body = el("tbody");
      for (const m of list.slice(0, ROW_CAP)) {
        const row = el("tr");
        if (this.strip) {
          row.tabIndex = 0;
          const pick = () => {
            const pad = Math.max(m.dur, profileSpan(p) / 200);
            this.strip?.select([Math.max(0, m.start - (m.dur ? 0 : pad / 2)), m.start + (m.dur || pad / 2)]);
            this.show("flame");
          };
          row.addEventListener("click", pick);
          row.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick();
            }
          });
        }
        const th = p.threads[m.thread];
        row.append(
          el("td", "num", duration(m.start)),
          el("td", "num", m.dur ? duration(m.dur) : ""),
          el("td", "fn", m.name),
          el("td", "mod", m.category),
          el("td", "mod", th ? threadName(th) : ""),
          el("td", "mod", m.detail),
        );
        body.append(row);
      }
      table.append(head, body);
      host.replaceChildren(table);
      if (list.length > ROW_CAP) host.append(el("p", "ot-prof-empty", t("profile.rowsCapped", { n: ROW_CAP.toLocaleString(getLocale()) })));
    };
    let wait = 0;
    q.addEventListener("input", () => {
      window.clearTimeout(wait);
      wait = window.setTimeout(() => {
        this.markerQuery = q.value.trim();
        draw();
      }, 120);
    });
    draw();
  }

  // --- status bar zoom ------------------------------------------------------------------------

  private buildBar(): void {
    const bar = el("div", "cm-statusbar");
    const grow = el("span", "cm-statusbar-grow");
    const range = el("input");
    range.type = "range";
    range.min = "0";
    range.max = String(ZOOM_STEPS);
    range.step = "1";
    range.value = "0";
    range.title = t("profile.zoom");
    range.setAttribute("aria-label", t("profile.zoom"));
    range.addEventListener("input", () => {
      const fg = this.flame;
      if (fg) fg.setZoomLevel(Math.pow(fg.maxZoom(), Number(range.value) / ZOOM_STEPS));
    });
    const pctEl = el("span", "cm-statusbar-pct");
    pctEl.setAttribute("aria-label", t("profile.zoomLevel"));
    bar.append(grow, range, pctEl);
    this.bar = bar;
    this.zoomRange = range;
    this.zoomPct = pctEl;
    this.enableZoom(false);
  }

  private enableZoom(on: boolean): void {
    if (this.zoomRange) this.zoomRange.disabled = !on;
    if (this.zoomPct) this.zoomPct.style.visibility = on ? "" : "hidden";
  }

  private showZoom(): void {
    const fg = this.flame;
    const range = this.zoomRange;
    if (!fg || !range || !this.zoomPct) return;
    const z = fg.zoomLevel();
    const max = fg.maxZoom();
    range.value = String(max > 1 ? Math.round((Math.log(Math.max(1, z)) / Math.log(max)) * ZOOM_STEPS) : 0);
    const text = new Intl.NumberFormat(getLocale(), { notation: "compact", maximumFractionDigits: z < 10 ? 1 : 0 }).format(z);
    this.zoomPct.textContent = `×${text}`;
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
    this.flame?.focus();
  }
  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.pending);
    this.flame?.dispose();
    this.flame = null;
    this.strip?.dispose();
    this.strip = null;
    this.bar?.remove();
    this.bar = null;
    this.root?.remove();
    this.root = null;
  }
}

export const profileViewer: EditorModule = {
  create: () => new ProfileInstance(),
};
