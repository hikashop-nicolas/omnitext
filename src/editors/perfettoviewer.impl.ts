import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";
import { getLocale, t } from "../i18n";
import { isNative } from "../core/platform";
import { LOG_CAP, parseTrace, type LogEntry, type TraceSummary } from "./perfetto-parse";
import { sendToPerfetto } from "./perfetto-handoff";

// Read-only Perfetto trace summary. The full timeline is Perfetto UI's job: on request the
// trace is handed to ui.perfetto.dev (perfetto-handoff.ts).

const STYLE_ID = "omnitext-perfetto-style";
const ROW_CAP = 1000;
const PRIO = ["", "", "V", "D", "I", "W", "E", "F"];

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pf { height:100%; overflow:auto; background:var(--canvas);
      color:var(--text); font:13px system-ui, sans-serif; }
    .ot-pf-head { padding:10px 16px; border-bottom:1px solid var(--border); background:var(--chrome);
      display:flex; flex-wrap:wrap; gap:8px 24px; align-items:flex-start; }
    .ot-pf-facts { display:grid; grid-template-columns:auto 1fr; gap:2px 12px; flex:1 1 320px; min-width:0; }
    .ot-pf-facts dt { color:var(--muted); }
    .ot-pf-facts dd { margin:0; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
    .ot-pf-open { flex:0 1 340px; display:flex; flex-direction:column; gap:6px; }
    .ot-pf-open p { margin:0; color:var(--muted); font-size:12px; }
    .ot-pf-btn { font:inherit; padding:5px 12px; border:1px solid var(--border); border-radius:6px;
      background:var(--surface); color:var(--text); cursor:pointer; align-self:flex-start; }
    .ot-pf-btn:hover { border-color:var(--accent); }
    .ot-pf-btn:disabled { opacity:.6; cursor:default; }
    .ot-pf-notes { padding:0 16px; }
    .ot-pf-notes p { margin:8px 0; color:var(--amber); }
    .ot-pf-tabs { position:sticky; top:0; z-index:2; display:flex; gap:2px; padding:0 12px;
      border-bottom:1px solid var(--border); overflow-x:auto; background:var(--canvas); }
    .ot-pf-tab { font:inherit; padding:8px 12px; border:0; border-bottom:2px solid transparent; background:none;
      color:var(--muted); cursor:pointer; white-space:nowrap; }
    .ot-pf-tab[aria-selected="true"] { color:var(--text); border-bottom-color:var(--accent); }
    .ot-pf-panel { padding:8px 16px 16px; overflow-x:auto; }
    .ot-pf-tools { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:4px 0 8px; }
    .ot-pf-tools input, .ot-pf-tools select { font:inherit; padding:4px 8px; border:1px solid var(--border);
      border-radius:6px; background:var(--bg); color:var(--text); }
    .ot-pf-tools input { flex:1 1 220px; min-width:0; }
    .ot-pf-count { color:var(--muted); }
    .ot-pf table { border-collapse:collapse; font:12px/1.4 ui-monospace, monospace; }
    .ot-pf th, .ot-pf td { border-bottom:1px solid var(--border); padding:3px 10px 3px 0; text-align:left;
      vertical-align:top; }
    .ot-pf th { background:var(--canvas); font:600 12px system-ui, sans-serif; z-index:1; }
    .ot-pf td.num, .ot-pf th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .ot-pf td.wrap { white-space:pre-wrap; overflow-wrap:anywhere; min-width:240px; }
    .ot-pf td.bar { width:30%; min-width:80px; }
    .ot-pf td.bar span { display:block; height:8px; border-radius:4px; background:var(--accent); opacity:.55; }
    .ot-pf tr.p-W td { color:var(--amber); }
    .ot-pf tr.p-E td, .ot-pf tr.p-F td { color:#dc2626; }
    .ot-pf-msg { color:var(--muted); padding:24px; text-align:center; white-space:pre-wrap; }
    .ot-pf-empty { color:var(--muted); padding:12px 0; }
    .ot-pf-hint { color:var(--muted); margin:4px 0 8px; }
    .ot-pf h3 { font-size:13px; margin:16px 0 6px; }
  `;
  document.head.appendChild(s);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
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
  if (name === "(unnamed)") return t("perfetto.unnamed");
  return name;
}

type Tab = "overview" | "processes" | "ftrace" | "logs" | "slices";

class PerfettoInstance implements EditorInstance {
  private root: HTMLElement | null = null;
  private disposed = false;
  private bytes: Uint8Array = new Uint8Array();
  private name = "trace.pftrace";
  private cleanup: (() => void) | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    const root = el("div", "ot-pf");
    container.appendChild(root);
    this.root = root;
    this.bytes = ctx.bytes ?? new Uint8Array();
    this.name = ctx.filename || this.name;
    const msg = el("div", "ot-pf-msg", t("perfetto.reading", { percent: 0 }));
    root.appendChild(msg);
    void parseTrace(this.bytes, {
      onProgress: (s) => {
        msg.textContent = t("perfetto.reading", { percent: Math.floor((s.read / Math.max(1, s.bytes)) * 100) });
      },
      cancelled: () => this.disposed,
    })
      .then((s) => {
        if (this.disposed) return;
        root.textContent = "";
        if (!s.packets) {
          root.appendChild(el("div", "ot-pf-msg", t("perfetto.notTrace")));
          return;
        }
        this.render(root, s);
      })
      .catch((e: unknown) => {
        if (this.disposed) return;
        msg.textContent = t("perfetto.failed", { error: (e as Error)?.message ?? String(e) });
      });
  }

  private render(root: HTMLElement, s: TraceSummary): void {
    root.append(this.header(s));
    const notes = this.notes(s);
    if (notes) root.append(notes);
    const tabs = el("div", "ot-pf-tabs");
    tabs.setAttribute("role", "tablist");
    const panel = el("div", "ot-pf-panel");
    panel.setAttribute("role", "tabpanel");
    const list: [Tab, string][] = [
      ["overview", t("perfetto.tabOverview")],
      ["processes", `${t("perfetto.tabProcesses")} (${num(s.processes.size)})`],
      ["ftrace", `${t("perfetto.tabFtrace")} (${num(s.ftraceTotal)})`],
      ["logs", `${t("perfetto.tabLogs")} (${num(s.logTotal)})`],
      ["slices", t("perfetto.tabSlices")],
    ];
    const buttons: HTMLButtonElement[] = [];
    const show = (tab: Tab) => {
      buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
      panel.textContent = "";
      // Keep the tab bar in view when switching from far down a long table.
      if (root.scrollTop > tabs.offsetTop) root.scrollTop = tabs.offsetTop;
      if (tab === "overview") this.overview(panel, s);
      else if (tab === "processes") this.processes(panel, s);
      else if (tab === "ftrace") this.ftrace(panel, s);
      else if (tab === "logs") this.logs(panel, s);
      else this.slices(panel, s);
    };
    for (const [id, text] of list) {
      const b = el("button", "ot-pf-tab", text);
      b.type = "button";
      b.dataset.tab = id;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => show(id));
      buttons.push(b);
      tabs.append(b);
    }
    root.append(tabs, panel);
    show("overview");
  }

  private header(s: TraceSummary): HTMLElement {
    const head = el("div", "ot-pf-head");
    const dl = el("dl", "ot-pf-facts");
    const fact = (k: string, v: string | undefined) => {
      if (!v) return;
      dl.append(el("dt", "", k), el("dd", "", v));
    };
    if (s.firstTs !== null && s.lastTs !== null) fact(t("perfetto.duration"), duration(s.lastTs - s.firstTs));
    if (s.wallStartMs !== null) {
      fact(t("perfetto.start"), new Date(s.wallStartMs).toLocaleString(getLocale(), { dateStyle: "medium", timeStyle: "medium" }));
    }
    fact(t("perfetto.packets"), num(s.packets));
    fact(t("perfetto.size"), size(s.bytes));
    const sys = s.system;
    if (sys) {
      fact(t("perfetto.device"), [sys.manufacturer, sys.soc].filter(Boolean).join(" · ") || undefined);
      fact(t("perfetto.build"), sys.fingerprint);
      fact(t("perfetto.sdk"), sys.sdk ? String(sys.sdk) : undefined);
      fact(t("perfetto.kernel"), sys.kernel);
      fact(t("perfetto.cpus"), sys.cpus ? String(sys.cpus) : undefined);
    }
    head.append(dl, this.openBox());
    return head;
  }

  private openBox(): HTMLElement {
    const box = el("div", "ot-pf-open");
    if (isNative()) {
      // The app's WebView hands a new window to the system browser, which postMessage cannot reach.
      box.append(el("p", "", t("perfetto.openInApp")));
      return box;
    }
    const btn = el("button", "ot-pf-btn", t("perfetto.open"));
    btn.type = "button";
    const note = el("p", "", t("perfetto.openNote"));
    const status = el("p", "");
    btn.addEventListener("click", () => this.sendToPerfetto(btn, status));
    box.append(btn, note, status);
    return box;
  }

  private sendToPerfetto(btn: HTMLButtonElement, status: HTMLElement): void {
    this.cleanup?.();
    const handoff = sendToPerfetto(this.bytes, this.name);
    this.cleanup = () => {
      handoff.cancel();
      this.cleanup = null;
    };
    btn.disabled = true;
    status.textContent = t("perfetto.openWaiting");
    void handoff.result.then((r) => {
      btn.disabled = false;
      status.textContent = t(r === "sent" ? "perfetto.openSent" : r === "blocked" ? "perfetto.openBlocked" : "perfetto.openTimeout");
    });
  }

  private notes(s: TraceSummary): HTMLElement | null {
    const lines: string[] = [];
    if (s.stoppedAt !== null) lines.push(t("perfetto.stopped", { at: num(s.stoppedAt) }));
    if (s.lostBundles) lines.push(t("perfetto.lost", { n: num(s.lostBundles) }));
    if (s.zstdPackets) lines.push(t("perfetto.zstd", { n: num(s.zstdPackets) }));
    if (s.badCompressed) lines.push(t("perfetto.badCompressed", { n: num(s.badCompressed) }));
    if (!lines.length) return null;
    const box = el("div", "ot-pf-notes");
    for (const l of lines) box.append(el("p", "", l));
    return box;
  }

  /** A two-column count table with a bar, biggest first. */
  private counts(parent: HTMLElement, title: string, m: Map<string, number>, cap = 500): void {
    const rows = [...m].sort((a, b) => b[1] - a[1]);
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

  private overview(panel: HTMLElement, s: TraceSummary): void {
    panel.append(el("h3", "", t("perfetto.dataTypes")));
    this.counts(panel, t("perfetto.dataType"), s.packetTypes);
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
    const input = el("input");
    input.type = "search";
    input.placeholder = t("perfetto.filterProcesses");
    input.setAttribute("aria-label", t("perfetto.filterProcesses"));
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
    this.counts(panel, t("perfetto.event"), s.ftrace);
  }

  private slices(panel: HTMLElement, s: TraceSummary): void {
    if (!s.atrace.size && !s.trackEvents.size) {
      panel.append(el("p", "ot-pf-empty", t("perfetto.noSlices")));
      return;
    }
    panel.append(el("p", "ot-pf-hint", t("perfetto.slicesHint")));
    if (s.atrace.size) {
      panel.append(el("h3", "", t("perfetto.atrace")));
      this.counts(panel, t("perfetto.name"), s.atrace);
    }
    if (s.trackEvents.size) {
      panel.append(el("h3", "", t("perfetto.trackEvents")));
      this.counts(panel, t("perfetto.name"), s.trackEvents);
    }
  }

  private logs(panel: HTMLElement, s: TraceSummary): void {
    if (!s.logTotal) {
      panel.append(el("p", "ot-pf-empty", t("perfetto.noLogs")));
      return;
    }
    if (s.logTotal > LOG_CAP) panel.append(el("p", "ot-pf-hint", t("perfetto.logCapped", { n: num(LOG_CAP), total: num(s.logTotal) })));
    const origin = s.firstTs ?? 0;
    const tools = el("div", "ot-pf-tools");
    const input = el("input");
    input.type = "search";
    input.placeholder = t("perfetto.filterLogs");
    input.setAttribute("aria-label", t("perfetto.filterLogs"));
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
    tools.append(input, level, count);
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
      const min = Number(level.value);
      const pidQ = /^\d+$/.test(q) ? Number(q) : -1;
      const out: LogEntry[] = [];
      let total = 0;
      for (const l of s.logs) {
        if (l.prio < min && min) continue;
        if (q && l.pid !== pidQ && l.tid !== pidQ && !l.tag.toLowerCase().includes(q) && !l.msg.toLowerCase().includes(q)) continue;
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
    input.addEventListener("input", () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(draw, 120);
    });
    level.addEventListener("change", draw);
    draw();
  }

  getText(): string {
    return "";
  }
  selection(): unknown {
    return null;
  }
  focus(): void {}
  dispose(): void {
    this.disposed = true;
    this.cleanup?.();
    this.root?.remove();
    this.root = null;
  }
}

export const perfettoViewer: EditorModule = {
  create: () => new PerfettoInstance(),
};
