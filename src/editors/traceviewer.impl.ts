import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { getLocale, t } from "../i18n";
import { LOG_CAP, type LogEntry, type TraceSummary } from "./perfetto-parse";
import type { SliceRef, SliceTrack, TraceModel } from "./trace-model";
import { Timeline, type TimelineSelection } from "./trace-timeline";
import { openArchiveStream } from "../core/archive-stream";
import { loadArchive, loadBytes, loadText, type ArchiveFile, type LoadedTrace, type TraceKind } from "./trace-load";
import type { StatKind, TraceStats } from "./trace-stats";

// Read-only trace viewer for Perfetto protobuf, Chrome JSON, systrace and ftrace text, Fuchsia
// FXT, ninja logs, strace, logcat and archives of them: all fill the same model, so the
// timeline, search and filters work the same for each.

const STYLE_ID = "omnitext-trace-style";
const ROW_CAP = 1000;
const MATCH_CAP = 100_000;
const PRIO = ["", "", "V", "D", "I", "W", "E", "F"];
const STATE_KEYS = ["stateRunning", "stateRunnable", "stateSleeping", "stateUninterruptible", "stateStopped", "stateDead", "stateIdle", "stateUnknown"];
// Zoom slider steps: the level goes up exponentially along the slider.
const ZOOM_STEPS = 1000;

type Kind = TraceKind;

const FORMAT_KEYS: Record<Kind, string> = {
  perfetto: "formatPerfetto", json: "formatJson", systrace: "formatSystrace", ctrace: "formatCtrace", ninja: "formatNinja",
  strace: "formatStrace", logcat: "formatLogcat", fuchsia: "formatFuchsia", archive: "formatArchive",
};

/** Archive entries that are not content: folders' metadata, macOS resource forks, dotfiles. */
const junk = (name: string): boolean => /(^|\/)(__MACOSX\/|\.(?!ninja_log$)[^/]*$)/.test(name);

/** Whether these bytes (or this name) are a zip, a tar or a gzipped tar rather than a trace. */
function isArchive(bytes: Uint8Array | null, name = ""): boolean {
  if (!bytes) return true;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return true;
  if (bytes.length > 262 && String.fromCharCode(...bytes.subarray(257, 262)) === "ustar") return true;
  return bytes[0] === 0x1f && bytes[1] === 0x8b && /\.(?:tar\.gz|tgz)$/i.test(name);
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pf { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--canvas);
      color:var(--text); font:13px system-ui, sans-serif; }
    .ot-pf-head { flex:0 0 auto; padding:6px 16px; border-bottom:1px solid var(--border); background:var(--chrome);
      color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ot-pf-notes { flex:0 0 auto; padding:0 16px; }
    .ot-pf-notes p { margin:6px 0; color:var(--amber); }
    .ot-pf-notes p.info { color:var(--muted); overflow-wrap:anywhere; }
    .ot-pf-tabs { flex:0 0 auto; display:flex; gap:2px; padding:0 12px; border-bottom:1px solid var(--border);
      overflow-x:auto; background:var(--canvas); }
    .ot-pf-tab { font:inherit; padding:8px 12px; border:0; border-bottom:2px solid transparent; background:none;
      color:var(--muted); cursor:pointer; white-space:nowrap; }
    .ot-pf-tab[aria-selected="true"] { color:var(--text); border-bottom-color:var(--accent); }
    .ot-pf-tab:focus-visible, .ot-pf-btn:focus-visible, .ot-tl-canvas:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
    .ot-pf-panel { flex:1 1 auto; min-height:0; overflow:auto; padding:8px 16px 16px; }
    .ot-pf-panel.is-timeline { display:flex; flex-direction:column; overflow:hidden; padding:0; }
    .ot-pf-panel[hidden] { display:none; }
    .ot-pf-tools { display:flex; flex-wrap:wrap; gap:6px 8px; align-items:center; margin:4px 0 8px; }
    .is-timeline > .ot-pf-tools { margin:0; padding:6px 12px; border-bottom:1px solid var(--border); }
    .ot-pf-tools input, .ot-pf-tools select { font:inherit; padding:4px 8px; border:1px solid var(--border);
      border-radius:6px; background:var(--bg); color:var(--text); min-width:0; }
    .ot-pf-tools input[type=search] { flex:1 1 180px; }
    .ot-pf-tools input.narrow { flex:0 1 110px; }
    .ot-pf-tools input.rows { flex:0 1 240px; }
    .ot-pf-btn { font:inherit; padding:4px 10px; border:1px solid var(--border); border-radius:6px;
      background:var(--surface); color:var(--text); cursor:pointer; }
    .ot-pf-btn:hover { border-color:var(--accent); }
    .ot-pf-btn:disabled { opacity:.5; cursor:default; }
    .ot-pf-count { color:var(--muted); font-variant-numeric:tabular-nums; }
    .ot-pf-help { color:var(--muted); font-size:12px; flex:1 1 100%; }
    @media (max-width: 600px) { .ot-pf-help { display:none; } .ot-pf td.bar, .ot-pf th.bar { display:none; } .ot-pf td.wrap { min-width:160px; } .ot-pf-panel { padding:8px 10px 16px; } }
    .ot-pf table { border-collapse:collapse; font:12px/1.4 ui-monospace, monospace; }
    .ot-pf th, .ot-pf td { border-bottom:1px solid var(--border); padding:3px 10px 3px 0; text-align:left;
      vertical-align:top; }
    .ot-pf th { font:600 12px system-ui, sans-serif; }
    .ot-pf td.num, .ot-pf th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .ot-pf td.wrap { white-space:pre-wrap; overflow-wrap:anywhere; min-width:240px; }
    .ot-pf td.bar { width:30%; min-width:80px; }
    .ot-pf td.bar span { display:block; height:8px; border-radius:4px; background:var(--accent); opacity:.55; }
    .ot-pf tr.p-W td { color:var(--amber); }
    .ot-pf tr.p-E td, .ot-pf tr.p-F td { color:#dc2626; }
    .ot-pf-msg { margin:auto; color:var(--muted); padding:24px; text-align:center; white-space:pre-wrap; }
    .ot-pf-empty { color:var(--muted); padding:12px 0; }
    .ot-pf-hint { color:var(--muted); margin:4px 0 8px; }
    .ot-pf h3 { font-size:13px; margin:16px 0 6px; }
    .ot-pf-facts { display:grid; grid-template-columns:auto 1fr; gap:2px 12px; margin:8px 0; }
    .ot-pf-facts dt { color:var(--muted); }
    .ot-pf-facts dd { margin:0; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
    .ot-pf-details { flex:0 0 auto; max-height:30%; overflow:auto; padding:6px 12px; border-top:1px solid var(--border);
      background:var(--chrome); font-size:12px; }
    .ot-pf-details .ot-pf-facts { margin:0; }
    .ot-pf-flows { display:flex; flex-wrap:wrap; gap:4px 6px; margin:4px 0 0; }
    .ot-pf-flows button { font:inherit; padding:2px 8px; border:1px solid var(--border); border-radius:6px; background:var(--surface);
      color:var(--text); cursor:pointer; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ot-pf-flows button:hover { border-color:var(--accent); }
    .ot-pf-flows button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
    .ot-pf-details pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.4 ui-monospace, monospace; }
    .ot-tl { position:relative; flex:1 1 auto; min-height:0; display:flex; }
    .ot-tl-scroll { flex:1 1 auto; overflow-y:auto; overflow-x:hidden; position:relative; }
    .ot-tl-spacer { position:relative; }
    .ot-tl-canvas { position:sticky; top:0; display:block; }
    .ot-tl-tip { position:absolute; z-index:3; pointer-events:none; max-width:360px; padding:4px 8px; border-radius:6px;
      background:var(--text); color:var(--canvas); font:12px/1.4 system-ui, sans-serif; white-space:pre-wrap;
      overflow-wrap:anywhere; box-shadow:var(--shadow); }
  `;
  document.head.appendChild(s);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const button = (text: string, onClick: () => void, title?: string): HTMLButtonElement => {
  const b = el("button", "ot-pf-btn", text);
  b.type = "button";
  if (title) {
    b.title = title;
    b.setAttribute("aria-label", title);
  }
  b.addEventListener("click", onClick);
  return b;
};

const searchBox = (placeholder: string): HTMLInputElement => {
  const i = el("input");
  i.type = "search";
  i.placeholder = placeholder;
  i.setAttribute("aria-label", placeholder);
  return i;
};

const num = (n: number): string => n.toLocaleString(getLocale());

function unit(value: number, u: string, digits = 1): string {
  try {
    return new Intl.NumberFormat(getLocale(), { style: "unit", unit: u, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${u}`;
  }
}

function duration(ns: number): string {
  const sec = ns / 1e9;
  if (sec < 1) return unit(ns / 1e6, "millisecond", 2);
  if (sec < 120) return unit(sec, "second", 3);
  return unit(sec / 60, "minute", 1);
}

const size = (n: number): string =>
  n < 1048576 ? unit(n / 1024, "kilobyte", 1) : unit(n / 1048576, "megabyte", 1);

/** Display name for a counted bucket: the overflow bucket and placeholders are translated. */
function label(name: string): string {
  if (name === "…") return t("perfetto.other");
  if (name === "(empty)") return t("perfetto.emptyPacket");
  if (name === "") return t("perfetto.unnamed");
  return name;
}

type Tab = "timeline" | "overview" | "processes" | "ftrace" | "logs" | "slices";

interface Match {
  track: SliceTrack;
  level: number;
  index: number;
  ts: number;
}

class TraceInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private disposed = false;
  private timeline: Timeline | null = null;
  private show: ((tab: Tab) => void) | null = null;
  private logQuery = "";
  // A text trace hands its text back: the host remounts from getText() (on a theme change, say).
  private text = "";
  private bar: HTMLElement | null = null;
  private zoomRange: HTMLInputElement | null = null;
  private zoomPct: HTMLElement | null = null;
  private stats: TraceStats | null = null;
  private files: ArchiveFile[] | undefined;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.buildBar();
    const root = el("div", "ot-pf");
    container.appendChild(root);
    this.root = root;
    this.text = ctx.binary ? "" : ctx.text;
    const msg = el("div", "ot-pf-msg", t("perfetto.reading", { percent: 0 }));
    root.appendChild(msg);
    void this.load(ctx, msg)
      .then((r) => {
        if (this.disposed || !r) return;
        root.textContent = "";
        if (!r.summary.packets && !r.model.sliceCount && !r.model.schedCount && !r.model.groups.length && !r.summary.logTotal) {
          root.appendChild(el("div", "ot-pf-msg", t("perfetto.notTrace")));
          return;
        }
        this.render(root, r.kind, r.summary, r.model);
      })
      .catch((e: unknown) => {
        if (this.disposed) return;
        msg.textContent = t("perfetto.failed", { error: (e as Error)?.message ?? String(e) });
      });
  }

  private async load(ctx: EditorMountContext, msg: HTMLElement): Promise<{ kind: Kind; summary: TraceSummary; model: TraceModel } | null> {
    const progress = (percent: number) => (msg.textContent = t("perfetto.reading", { percent }));
    const opts = { onProgress: progress, cancelled: () => this.disposed };
    let r: LoadedTrace;
    if (ctx.binary && (ctx.blob || ctx.bytes) && isArchive(ctx.bytes, ctx.filename)) {
      // An archive of traces, streamed entry by entry from its Blob.
      const blob = ctx.blob ?? new Blob([ctx.bytes as BlobPart]);
      const handle = await openArchiveStream(blob, ctx.filename);
      if (!handle) throw new Error(t("archive.unreadable"));
      const entries = handle.entries.filter((e) => !e.dir && !junk(e.name)).sort((x, y) => x.name.localeCompare(y.name));
      r = await loadArchive(entries.map((e) => ({ name: e.name, read: () => handle.read(e.name) })), blob.size, opts);
    } else if (ctx.binary && ctx.bytes) {
      r = await loadBytes(ctx.bytes, opts);
    } else {
      msg.textContent = t("perfetto.building");
      await new Promise((res) => setTimeout(res, 0));
      r = await loadText(ctx.text);
    }
    if (this.disposed) return null;
    this.stats = r.stats;
    this.files = r.files;
    return r;
  }

  private render(root: HTMLElement, kind: Kind, s: TraceSummary, model: TraceModel): void {
    for (const g of model.groups) {
      if (g.key === "global") g.label = t("perfetto.groupGlobal");
      else if (g.key === "threads") g.label = t("perfetto.groupThreads");
    }
    const fmt = t(`perfetto.${FORMAT_KEYS[kind]}`);
    const head = [fmt];
    // Untimed input (strace without -t, logcat -v brief) has no duration to show.
    const timed = !this.stats?.facts.some((f) => f.key === "straceNoTime");
    if (timed && s.firstTs !== null && s.lastTs !== null && s.lastTs > s.firstTs) head.push(duration(s.lastTs - s.firstTs));
    head.push(size(s.bytes));
    root.append(el("div", "ot-pf-head", head.join(" · ")));
    const notes = this.notes(s);
    if (notes) root.append(notes);
    const tabs = el("div", "ot-pf-tabs");
    tabs.setAttribute("role", "tablist");
    const panel = el("div", "ot-pf-panel");
    panel.setAttribute("role", "tabpanel");
    const list = [
      ["timeline", t("perfetto.tabTimeline")],
      ["overview", t("perfetto.tabOverview")],
      ["processes", `${t("perfetto.tabProcesses")} (${num(s.processes.size)})`],
      ["ftrace", `${t("perfetto.tabFtrace")} (${num(s.ftraceTotal)})`],
      ["logs", `${t("perfetto.tabLogs")} (${num(s.logTotal)})`],
      ["slices", t("perfetto.tabSlices")],
    ].filter(([id]) => {
      // Formats that never hold kernel events or log lines leave those tabs out.
      if (id === "ftrace") return s.ftraceTotal > 0 || ["perfetto", "systrace", "ctrace", "archive"].includes(kind);
      if (id === "logs") return s.logTotal > 0 || ["perfetto", "archive"].includes(kind);
      return true;
    }) as [Tab, string][];
    const buttons: HTMLButtonElement[] = [];
    // The timeline is built once and kept across tab switches.
    const tlPanel = el("div", "ot-pf-panel is-timeline");
    tlPanel.setAttribute("role", "tabpanel");
    let tlBuilt = false;
    const show = (tab: Tab) => {
      buttons.forEach((b) => {
        const on = b.dataset.tab === tab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      tlPanel.hidden = tab !== "timeline";
      panel.hidden = tab === "timeline";
      this.enableZoom(tab === "timeline" && !!this.timeline);
      if (tab === "timeline") {
        if (!tlBuilt) {
          tlBuilt = true;
          this.timelineTab(tlPanel, model, s);
        }
        this.timeline?.redraw();
        return;
      }
      panel.textContent = "";
      panel.scrollTop = 0;
      if (tab === "overview") this.overview(panel, kind, s, model);
      else if (tab === "processes") this.processes(panel, s);
      else if (tab === "ftrace") this.ftrace(panel, s);
      else if (tab === "logs") this.logs(panel, s);
      else this.slices(panel, model);
    };
    this.show = show;
    for (const [id, text] of list) {
      const b = el("button", "ot-pf-tab", text);
      b.type = "button";
      b.dataset.tab = id;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => show(id));
      buttons.push(b);
      tabs.append(b);
    }
    // Arrow keys move between tabs, as a tablist does.
    tabs.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]!;
      next.focus();
      next.click();
      e.preventDefault();
    });
    root.append(tabs, tlPanel, panel);
    show(model.groups.length ? "timeline" : s.logTotal ? "logs" : "overview");
  }

  // --- timeline -----------------------------------------------------------------------------

  private timelineTab(panel: HTMLElement, model: TraceModel, s: TraceSummary): void {
    if (!model.groups.length) {
      panel.append(el("p", "ot-pf-msg", t("perfetto.emptyTimeline")));
      return;
    }
    const tools = el("div", "ot-pf-tools");
    const search = searchBox(t("perfetto.search"));
    const prev = button("‹", () => go(-1), t("perfetto.prevMatch"));
    const next = button("›", () => go(1), t("perfetto.nextMatch"));
    const count = el("span", "ot-pf-count");
    count.setAttribute("aria-live", "polite");
    const inLogs = button("", () => {
      this.logQuery = search.value.trim();
      this.show?.("logs");
    });
    inLogs.hidden = true;
    const rows = searchBox(t("perfetto.filterRows"));
    rows.classList.add("rows");
    const expand = button(t("perfetto.expandAll"), () => this.timeline?.setAllCollapsed(false));
    const collapse = button(t("perfetto.collapseAll"), () => this.timeline?.setAllCollapsed(true));
    const help = el("div", "ot-pf-help", t("perfetto.timelineHelp"));
    tools.append(search, prev, next, count, inLogs, rows, expand, collapse, help);
    const host = el("div");
    host.style.cssText = "flex:1 1 auto;min-height:0;display:flex;position:relative";
    const details = el("div", "ot-pf-details", t("perfetto.selectHint"));
    details.setAttribute("aria-live", "polite");
    panel.append(tools, host, details);
    const tl = new Timeline(
      host,
      model,
      {
        aria: t("perfetto.timelineAria"),
        max: (value) => t("perfetto.counterMax", { value }),
        states: STATE_KEYS.map((k) => t(`perfetto.${k}`)),
        onCpu: (n) => t("perfetto.onCpu", { n }),
      },
      getLocale(),
      (sel) => this.details(details, model, sel),
    );
    this.timeline = tl;
    tl.onView = () => this.showZoom();
    this.enableZoom(true);
    this.showZoom();

    let matches: Match[] = [];
    let current = -1;
    let ran = "";
    const run = () => {
      const q = search.value.trim().toLowerCase();
      ran = q;
      matches = [];
      current = -1;
      if (!q) {
        tl.setHighlight(null);
        count.textContent = "";
        inLogs.hidden = true;
        return;
      }
      const names = new Set<number>();
      model.names.forEach((n, i) => {
        if (n.toLowerCase().includes(q)) names.add(i);
      });
      outer: for (const g of model.groups) {
        for (const tr of g.tracks) {
          if (tr.kind !== "slices") continue;
          for (let d = 0; d < tr.levels.length; d++) {
            const lv = tr.levels[d]!;
            for (let i = 0; i < lv.name.length; i++) {
              if (!names.has(lv.name[i]!)) continue;
              matches.push({ track: tr, level: d, index: i, ts: lv.ts[i]! });
              if (matches.length >= MATCH_CAP) break outer;
            }
          }
        }
      }
      matches.sort((a, b) => a.ts - b.ts);
      tl.setHighlight(names);
      count.textContent = matches.length ? t("perfetto.matchOf", { n: 0, total: num(matches.length) }) : t("perfetto.noMatch");
      const logs = s.logs.reduce((n, l) => n + (l.msg.toLowerCase().includes(q) || l.tag.toLowerCase().includes(q) ? 1 : 0), 0);
      inLogs.hidden = !logs;
      inLogs.textContent = t("perfetto.logMatches", { n: num(logs) });
    };
    const go = (dir: number) => {
      if (search.value.trim().toLowerCase() !== ran) run();
      if (!matches.length) return;
      current = (current + dir + matches.length) % matches.length;
      const m = matches[current]!;
      tl.reveal({ track: m.track, level: m.level, index: m.index });
      count.textContent = t("perfetto.matchOf", { n: num(current + 1), total: num(matches.length) });
    };
    let timer = 0;
    search.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 300);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      window.clearTimeout(timer);
      go(e.shiftKey ? -1 : 1);
    });
    let rowTimer = 0;
    rows.addEventListener("input", () => {
      window.clearTimeout(rowTimer);
      rowTimer = window.setTimeout(() => tl.setFilter(rows.value), 200);
    });
  }

  private details(box: HTMLElement, model: TraceModel, sel: TimelineSelection | null): void {
    box.textContent = "";
    if (!sel) {
      box.textContent = t("perfetto.selectHint");
      return;
    }
    const dl = el("dl", "ot-pf-facts");
    const fact = (k: string, v: string | undefined) => {
      if (v) dl.append(el("dt", "", k), el("dd", "", v));
    };
    const tl = this.timeline!;
    const proc = (pid: number | undefined) => {
      if (pid === undefined) return undefined;
      const name = model.processes.get(pid)?.name;
      return name ? `${name} ${pid}` : String(pid);
    };
    let arg = -1;
    if (sel.track.kind === "slices" && sel.level < 0) {
      const tr = sel.track;
      const st = tr.states!;
      fact(t("perfetto.detailState"), tl.selName(sel));
      fact(t("perfetto.detailStart"), tl.formatTime(st.ts[sel.index]! - model.start));
      fact(t("perfetto.detailDuration"), tl.formatDuration(st.dur[sel.index]!));
      fact(t("perfetto.detailThread"), tr.tid !== undefined ? tl.threadName(tr.tid) : tr.label);
      fact(t("perfetto.detailProcess"), proc(tr.pid));
    } else if (sel.track.kind === "cpu") {
      const tr = sel.track;
      const tid = tr.tid[sel.index]!;
      fact(t("perfetto.detailThread"), tl.threadName(tid));
      fact(t("perfetto.detailProcess"), proc(model.threads.get(tid)?.pid));
      fact(t("perfetto.detailCpu"), String(tr.cpu));
      fact(t("perfetto.detailStart"), tl.formatTime(tr.ts[sel.index]! - model.start));
      fact(t("perfetto.detailDuration"), tl.formatDuration(tr.dur[sel.index]!));
    } else {
      const tr = sel.track;
      const lv = tr.levels[sel.level]!;
      fact(t("perfetto.detailName"), label(model.names[lv.name[sel.index]!] ?? ""));
      fact(t("perfetto.detailStart"), tl.formatTime(lv.ts[sel.index]! - model.start));
      fact(t("perfetto.detailDuration"), tl.formatDuration(lv.dur[sel.index]!));
      fact(t("perfetto.detailThread"), tr.tid !== undefined ? tl.threadName(tr.tid) : tr.label);
      fact(t("perfetto.detailProcess"), proc(tr.pid));
      arg = lv.arg[sel.index]!;
    }
    box.append(dl);
    const flows = tl.flows();
    if (flows.length) {
      // Each end of a flow is a button that goes to the slice at the other end.
      box.append(el("h3", "", t("perfetto.detailFlows", { n: num(flows.length) })));
      const list = el("div", "ot-pf-flows");
      const name = (r: SliceRef) => label(model.names[r.track.levels[r.level]!.name[r.index]!] ?? "");
      const where = (r: SliceRef) => (r.track.tid !== undefined ? tl.threadName(r.track.tid) : r.track.label);
      for (const f of flows.slice(0, 40)) {
        const incoming = f.to.track === sel.track && f.to.level === sel.level && f.to.index === sel.index;
        const other = incoming ? f.from : f.to;
        const text = t(incoming ? "perfetto.flowFrom" : "perfetto.flowTo", { name: name(other), thread: where(other) });
        list.append(button(text, () => tl.reveal(other), text));
      }
      box.append(list);
      if (flows.length > 40) box.append(el("p", "ot-pf-hint", t("perfetto.shownOf", { shown: num(40), total: num(flows.length) })));
    }
    if (arg >= 0 && model.args[arg]) {
      box.append(el("h3", "", t("perfetto.detailArgs")), el("pre", "", model.args[arg]));
    }
  }

  // --- status bar zoom ----------------------------------------------------------------------

  /** A zoom slider, in the app's status bar as the other viewers have them. */
  private buildBar(): void {
    const bar = el("div", "cm-statusbar");
    const grow = el("span", "cm-statusbar-grow");
    const range = el("input");
    range.type = "range";
    range.min = "0";
    range.max = String(ZOOM_STEPS);
    range.step = "1";
    range.value = "0";
    range.title = t("perfetto.zoom");
    range.setAttribute("aria-label", t("perfetto.zoom"));
    range.addEventListener("input", () => {
      const tl = this.timeline;
      if (tl) tl.setZoomLevel(Math.pow(tl.maxZoom(), Number(range.value) / ZOOM_STEPS));
    });
    const pct = el("span", "cm-statusbar-pct");
    pct.setAttribute("aria-label", t("perfetto.zoomLevel"));
    bar.append(grow, range, pct);
    this.bar = bar;
    this.zoomRange = range;
    this.zoomPct = pct;
    this.enableZoom(false);
  }

  private enableZoom(on: boolean): void {
    if (this.zoomRange) this.zoomRange.disabled = !on;
    if (this.zoomPct) this.zoomPct.style.visibility = on ? "" : "hidden";
  }

  /** The slider and readout follow the view, whatever moved it (wheel, pinch, keys, a match). */
  private showZoom(): void {
    const tl = this.timeline;
    const range = this.zoomRange;
    if (!tl || !range || !this.zoomPct) return;
    const z = tl.zoomLevel();
    const max = tl.maxZoom();
    range.value = String(max > 1 ? Math.round((Math.log(z) / Math.log(max)) * ZOOM_STEPS) : 0);
    const text = new Intl.NumberFormat(getLocale(), { notation: "compact", maximumFractionDigits: z < 10 ? 1 : 0 }).format(z);
    this.zoomPct.textContent = `×${text}`;
    range.setAttribute("aria-valuetext", `×${text}`);
  }

  statusItems(): HTMLElement | null {
    return this.bar;
  }

  // --- other tabs ---------------------------------------------------------------------------

  private notes(s: TraceSummary): HTMLElement | null {
    const lines: string[] = [];
    if (s.stoppedAt !== null) lines.push(t("perfetto.stopped", { at: num(s.stoppedAt) }));
    if (s.lostBundles) lines.push(t("perfetto.lost", { n: num(s.lostBundles) }));
    if (s.zstdPackets) lines.push(t("perfetto.zstd", { n: num(s.zstdPackets) }));
    if (s.badCompressed) lines.push(t("perfetto.badCompressed", { n: num(s.badCompressed) }));
    // Which files of an archive were read: information, not a warning.
    const info: string[] = [];
    if (this.files) {
      const read = this.files.filter((f) => f.kind).map((f) => f.name);
      const left = this.files.filter((f) => !f.kind).map((f) => f.name);
      if (read.length) info.push(t("perfetto.archiveRead", { list: read.join(", ") }));
      if (left.length) info.push(t("perfetto.archiveSkipped", { list: left.join(", ") }));
    }
    if (!lines.length && !info.length) return null;
    const box = el("div", "ot-pf-notes");
    for (const l of lines) box.append(el("p", "", l));
    for (const l of info) box.append(el("p", "info", l));
    return box;
  }

  /** A two-column count table with a bar, biggest first. */
  private counts(parent: HTMLElement, title: string, rows: [string, number][], cap = 500): void {
    rows.sort((a, b) => b[1] - a[1]);
    const table = el("table");
    const head = el("tr");
    head.append(el("th", "", title), el("th", "num", t("perfetto.count")), el("th"));
    table.append(head);
    const max = rows[0]?.[1] ?? 1;
    for (const [name, n] of rows.slice(0, cap)) {
      const tr = el("tr");
      const bar = el("td", "bar");
      const span = el("span");
      span.style.width = `${Math.max(1, (n / max) * 100)}%`;
      bar.append(span);
      tr.append(el("td", "", label(name)), el("td", "num", num(n)), bar);
      table.append(tr);
    }
    parent.append(table);
    if (rows.length > cap) parent.append(el("p", "ot-pf-hint", t("perfetto.shownOf", { shown: num(cap), total: num(rows.length) })));
  }

  private overview(panel: HTMLElement, kind: Kind, s: TraceSummary, model: TraceModel): void {
    const dl = el("dl", "ot-pf-facts");
    const fact = (k: string, v: string | undefined) => {
      if (v) dl.append(el("dt", "", k), el("dd", "", v));
    };
    fact(t("perfetto.formatLabel"), t(`perfetto.${FORMAT_KEYS[kind]}`));
    if (!this.stats?.facts.some((f) => f.key === "straceNoTime") && s.firstTs !== null && s.lastTs !== null && s.lastTs > s.firstTs) fact(t("perfetto.duration"), duration(s.lastTs - s.firstTs));
    if (s.wallStartMs !== null) {
      fact(t("perfetto.start"), new Date(s.wallStartMs).toLocaleString(getLocale(), { dateStyle: "medium", timeStyle: "medium" }));
    }
    if (s.packets) fact(t("perfetto.packets"), num(s.packets));
    if (model.sliceCount || kind !== "logcat") fact(t("perfetto.slices"), num(model.sliceCount));
    if (model.schedCount) fact(t("perfetto.schedSlices"), num(model.schedCount));
    fact(t("perfetto.size"), size(s.bytes));
    const sys = s.system;
    if (sys) {
      fact(t("perfetto.device"), [sys.manufacturer, sys.soc].filter(Boolean).join(" · ") || undefined);
      fact(t("perfetto.build"), sys.fingerprint);
      fact(t("perfetto.sdk"), sys.sdk ? String(sys.sdk) : undefined);
      fact(t("perfetto.kernel"), sys.kernel);
      fact(t("perfetto.cpus"), sys.cpus ? String(sys.cpus) : undefined);
    }
    const hints: string[] = [];
    for (const f of this.stats?.facts ?? []) {
      if (f.value === "") hints.push(t(`perfetto.${f.key}`));
      else fact(t(`perfetto.${f.key}`), this.statValue(f.value, f.kind));
    }
    panel.append(dl);
    for (const h of hints) panel.append(el("p", "ot-pf-hint", h));
    if (this.files) {
      panel.append(el("h3", "", t("perfetto.archiveFiles")));
      const table = el("table");
      const head = el("tr");
      head.append(el("th", "", t("perfetto.archiveFile")), el("th", "", t("perfetto.archiveReadAs")));
      table.append(head);
      for (const f of this.files) {
        const tr = el("tr");
        tr.append(el("td", "wrap", f.name), el("td", "", f.kind ? t(`perfetto.${FORMAT_KEYS[f.kind]}`) : t("perfetto.archiveNotTrace")));
        table.append(tr);
      }
      panel.append(table);
    }
    for (const tb of this.stats?.tables ?? []) {
      if (!tb.rows.length) continue;
      panel.append(el("h3", "", t(`perfetto.${tb.title}`)));
      this.statTable(panel, tb.cols, tb.rows, tb.bar);
    }
    if (s.packetTypes.size) {
      panel.append(el("h3", "", t("perfetto.dataTypes")));
      this.counts(panel, t("perfetto.dataType"), [...s.packetTypes]);
    }
  }

  private statValue(v: string | number, kind: StatKind = "text"): string {
    if (typeof v === "string") return v;
    if (kind === "dur") return duration(v);
    if (kind === "pct") return unit(v, "percent", 1);
    return num(v);
  }

  /** A table of format figures; `bar` names the column drawn as a bar. */
  private statTable(parent: HTMLElement, cols: { key: string; kind: StatKind }[], rows: (string | number)[][], bar?: number): void {
    const table = el("table");
    const head = el("tr");
    for (const c of cols) head.append(el("th", c.kind === "text" ? "" : "num", t(`perfetto.${c.key}`)));
    if (bar !== undefined) head.append(el("th", "bar"));
    table.append(head);
    const max = bar !== undefined ? Math.max(1, ...rows.map((r) => Number(r[bar]) || 0)) : 1;
    for (const r of rows) {
      const tr = el("tr");
      cols.forEach((c, i) => tr.append(el("td", c.kind === "text" ? (i === 0 ? "wrap" : "") : "num", c.kind === "text" ? label(String(r[i] ?? "")) : this.statValue(r[i] ?? 0, c.kind))));
      if (bar !== undefined) {
        const td = el("td", "bar");
        const span = el("span");
        span.style.width = `${Math.max(1, ((Number(r[bar]) || 0) / max) * 100)}%`;
        td.append(span);
        tr.append(td);
      }
      table.append(tr);
    }
    parent.append(table);
  }

  private processes(panel: HTMLElement, s: TraceSummary): void {
    if (!s.processes.size && !s.threads.size) {
      panel.append(el("p", "ot-pf-empty", t("perfetto.noProcesses")));
      return;
    }
    const threadsOf = new Map<number, string[]>();
    for (const th of s.threads.values()) {
      if (th.pid === undefined) continue;
      let l = threadsOf.get(th.pid);
      if (!l) threadsOf.set(th.pid, (l = []));
      l.push(th.name ? `${th.tid} ${th.name}` : String(th.tid));
    }
    // Threads whose process was never described still deserve a row.
    for (const pid of threadsOf.keys()) if (!s.processes.has(pid)) s.processes.set(pid, { pid });
    const all = [...s.processes.values()].sort((a, b) => a.pid - b.pid);
    const tools = el("div", "ot-pf-tools");
    const input = searchBox(t("perfetto.filterProcesses"));
    const count = el("span", "ot-pf-count");
    tools.append(input, count);
    const host = el("div");
    panel.append(tools, host);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const rows = q
        ? all.filter((p) => String(p.pid) === q || `${p.name ?? ""} ${p.cmdline ?? ""}`.toLowerCase().includes(q))
        : all;
      count.textContent = rows.length > ROW_CAP ? t("perfetto.shownOf", { shown: num(ROW_CAP), total: num(rows.length) }) : num(rows.length);
      const table = el("table");
      const head = el("tr");
      head.append(
        el("th", "num", t("perfetto.pid")),
        el("th", "", t("perfetto.name")),
        el("th", "num", t("perfetto.ppid")),
        el("th", "num", t("perfetto.threads")),
        el("th", "num", t("perfetto.rss")),
        el("th", "", t("perfetto.cmdline")),
      );
      table.append(head);
      for (const p of rows.slice(0, ROW_CAP)) {
        const tr = el("tr");
        const threads = threadsOf.get(p.pid) ?? [];
        const tdThreads = el("td", "num", threads.length ? num(threads.length) : "");
        if (threads.length) tdThreads.title = threads.slice(0, 40).join("\n") + (threads.length > 40 ? "\n…" : "");
        tr.append(
          el("td", "num", String(p.pid)),
          el("td", "", p.name ?? ""),
          el("td", "num", p.ppid !== undefined ? String(p.ppid) : ""),
          tdThreads,
          el("td", "num", p.rssKb !== undefined ? size(p.rssKb * 1024) : ""),
          el("td", "wrap", p.cmdline ?? ""),
        );
        table.append(tr);
      }
      host.replaceChildren(table);
    };
    input.addEventListener("input", draw);
    draw();
  }

  private ftrace(panel: HTMLElement, s: TraceSummary): void {
    if (!s.ftraceTotal) {
      panel.append(el("p", "ot-pf-empty", t("perfetto.noFtrace")));
      return;
    }
    if (s.cpus.size) panel.append(el("p", "ot-pf-hint", t("perfetto.cpusSeen", { n: num(s.cpus.size) })));
    this.counts(panel, t("perfetto.event"), [...s.ftrace]);
  }

  private slices(panel: HTMLElement, model: TraceModel): void {
    if (!model.sliceCount) {
      panel.append(el("p", "ot-pf-empty", t("perfetto.noSlices")));
      return;
    }
    panel.append(el("p", "ot-pf-hint", t("perfetto.slicesHint")));
    const rows: [string, number][] = [];
    model.nameCount.forEach((n, i) => {
      if (n) rows.push([model.names[i]!, n]);
    });
    this.counts(panel, t("perfetto.name"), rows);
  }

  private logs(panel: HTMLElement, s: TraceSummary): void {
    if (!s.logTotal) {
      panel.append(el("p", "ot-pf-empty", t("perfetto.noLogs")));
      return;
    }
    if (s.logTotal > LOG_CAP) panel.append(el("p", "ot-pf-hint", t("perfetto.logCapped", { n: num(LOG_CAP), total: num(s.logTotal) })));
    const origin = s.firstTs ?? 0;
    const tools = el("div", "ot-pf-tools");
    const input = searchBox(t("perfetto.filterLogs"));
    input.value = this.logQuery;
    const tag = searchBox(t("perfetto.filterTag"));
    tag.classList.add("narrow");
    const pid = searchBox(t("perfetto.filterPid"));
    pid.classList.add("narrow");
    pid.inputMode = "numeric";
    const level = el("select");
    level.setAttribute("aria-label", t("perfetto.minLevel"));
    const levels: [number, string][] = [
      [0, t("perfetto.levelAll")],
      [3, "D+"],
      [4, "I+"],
      [5, "W+"],
      [6, "E+"],
    ];
    for (const [v, text] of levels) {
      const o = el("option", "", text);
      o.value = String(v);
      level.append(o);
    }
    const count = el("span", "ot-pf-count");
    tools.append(input, tag, pid, level, count);
    const host = el("div");
    panel.append(tools, host);
    const relFmt = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const row = (l: LogEntry): HTMLTableRowElement => {
      const p = PRIO[l.prio] ?? "";
      const tr = el("tr", p ? `p-${p}` : undefined);
      tr.append(
        el("td", "num", l.ts ? relFmt.format((l.ts - origin) / 1e9) : ""),
        el("td", "num", String(l.pid)),
        el("td", "num", String(l.tid)),
        el("td", "", p),
        el("td", "", l.tag),
        el("td", "wrap", l.msg),
      );
      return tr;
    };
    let pending = 0;
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const tq = tag.value.trim().toLowerCase();
      const pq = pid.value.trim() ? Number(pid.value.trim()) : -1;
      const min = Number(level.value);
      const out: LogEntry[] = [];
      let total = 0;
      for (const l of s.logs) {
        if (min && l.prio < min) continue;
        if (pq >= 0 && l.pid !== pq && l.tid !== pq) continue;
        if (tq && !l.tag.toLowerCase().includes(tq)) continue;
        if (q && !l.tag.toLowerCase().includes(q) && !l.msg.toLowerCase().includes(q)) continue;
        total++;
        if (out.length < ROW_CAP) out.push(l);
      }
      count.textContent = total > ROW_CAP ? t("perfetto.shownOf", { shown: num(ROW_CAP), total: num(total) }) : num(total);
      const table = el("table");
      const head = el("tr");
      head.append(
        el("th", "num", t("perfetto.time")),
        el("th", "num", t("perfetto.pid")),
        el("th", "num", t("perfetto.tid")),
        el("th", "", t("perfetto.level")),
        el("th", "", t("perfetto.tag")),
        el("th", "", t("perfetto.message")),
      );
      table.append(head, ...out.map(row));
      host.replaceChildren(table);
    };
    for (const i of [input, tag, pid]) {
      i.addEventListener("input", () => {
        window.clearTimeout(pending);
        pending = window.setTimeout(draw, 120);
      });
    }
    level.addEventListener("change", draw);
    draw();
  }

  getText(): string {
    return this.text;
  }
  selection(): unknown {
    return null;
  }
  focus(): void {
    this.timeline?.focus();
  }
  dispose(): void {
    this.disposed = true;
    this.timeline?.dispose();
    this.timeline = null;
    this.bar?.remove();
    this.bar = null;
    this.root?.remove();
    this.root = null;
  }
}

export const traceViewer: EditorModule = {
  create: () => new TraceInstance(),
};
