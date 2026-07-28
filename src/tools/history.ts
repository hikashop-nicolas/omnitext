import type { Disposable, HostAPI, ToolModule } from "../core/types";
import { VersionStore, type Version } from "./version-store";
import { getLocale, t } from "../i18n";

// Snapshot labels are stored as stable English keys; translate them only for display.
const labelText = (label: string): string => {
  const key = `history.label.${label.toLowerCase()}`;
  const s = t(key);
  return s === key ? label : s;
};

// Version history + diff tool. Snapshots the active document (on save, on a debounce
// after edits, and on demand), and offers a panel to browse versions, diff any version
// against the current text, and restore one. Diffs use jsdiff, loaded lazily.

const STYLE_ID = "omnitext-history-style";
/** Quiet period after the last edit before an automatic snapshot. */
const AUTO_SNAPSHOT_MS = 45_000;
/** Longest an uninterrupted editing run may go without one. A debounce alone never fires
    while someone keeps typing, so a long steady session produced no snapshots at all. */
const AUTO_SNAPSHOT_MAX_MS = 180_000;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-hist { font: 13px/1.5 system-ui, -apple-system, sans-serif; }
    .ot-hist-bar { margin-bottom: 10px; }
    .ot-hist-list { display: flex; flex-direction: column; gap: 6px; }
    .ot-hist-empty { color: var(--muted); }
    .ot-hist-row { border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px; }
    .ot-hist-meta { display: flex; align-items: center; gap: 8px; }
    .ot-hist-time { font-weight: 600; }
    .ot-hist-label { color: var(--muted); font-size: 11px; }
    .ot-hist-size { color: var(--muted); font-size: 11px; margin-left: auto; }
    .ot-hist-actions { display: flex; gap: 6px; margin-top: 6px; }
    .ot-mini {
      font: inherit; font-size: 12px; padding: 2px 9px; border: 1px solid var(--border);
      border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer;
    }
    .ot-mini:hover { border-color: var(--accent); }
    .ot-mini.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .ot-diff {
      margin-top: 8px; max-height: 320px; overflow: auto; border-top: 1px solid var(--border);
      padding-top: 6px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .ot-diff-line { white-space: pre-wrap; }
    .ot-diff-line.add { color: #3fb950; }
    .ot-diff-line.del { color: #e5484d; }
    .ot-diff-line.ctx { color: var(--muted); }
  `;
  document.head.appendChild(s);
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, className = "ot-mini"): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// Exported for unit testing (the snapshot decision logic and byte comparison).
export function bytesEqual(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// A cheap signature of an editing-session snapshot (PDF), ignoring large byte buffers so two
// unchanged snapshots compare equal without deep-comparing embedded fonts/images.
export function stateSig(state: unknown): string {
  try {
    return JSON.stringify(state, (_k, v) => (v instanceof Uint8Array ? `u8:${v.length}` : v));
  } catch {
    return "";
  }
}

export async function snapshot(host: HostAPI, store: VersionStore, label: string): Promise<void> {
  const doc = host.workspace.getActiveDocument();
  if (!doc) return;
  // A viewer's document cannot change, so every snapshot would be the file itself: for a
  // video opened out of an archive that means storing the whole thing in IndexedDB to offer
  // a restore of what is already on screen.
  if (doc.readOnly) return;
  if (doc.binary) {
    // Editors that expose a lossless session snapshot (PDF) store that, so restore re-renders
    // the pristine document and replays edits rather than re-opening the lossy export.
    const state = host.workspace.getActiveState();
    if (state) {
      const sig = stateSig(state);
      const latest = await store.latestByKey(doc.key);
      if (latest?.stateSig === sig) return; // unchanged since last snapshot
      // The editor counts its own edits: only it knows what its state holds.
      const stateChanges = host.workspace.countActiveStateChanges?.(state) ?? undefined;
      await store.add({ key: doc.key, ts: Date.now(), formatId: doc.formatId, label, text: "", binary: true, state, stateSig: sig, stateChanges });
      return;
    }
    // Other binary editors (XLSX/ODS/DOCX/ODT) edit in place; their bytes re-import cleanly.
    const bytes = await host.workspace.getActiveBytes();
    if (!bytes || bytes.length === 0) return;
    const latest = await store.latestByKey(doc.key);
    if (bytesEqual(latest?.bytes, bytes)) return; // unchanged since last snapshot
    await store.add({ key: doc.key, ts: Date.now(), formatId: doc.formatId, label, text: "", binary: true, bytes });
    return;
  }
  if (doc.text.trim() === "") return;
  const latest = await store.latestByKey(doc.key);
  if (latest?.text === doc.text) return; // skip if unchanged since last snapshot
  await store.add({ key: doc.key, ts: Date.now(), formatId: doc.formatId, label, text: doc.text });
}

/**
 * Put a stored version back into the editor, capturing what is on screen first.
 * Without that capture, restoring silently discards every edit made since the last
 * snapshot: automatic ones are minutes apart, so there would be nothing to go back to.
 */
export async function restoreVersion(host: HostAPI, store: VersionStore, v: Version): Promise<void> {
  await snapshot(host, store, "BeforeRestore");
  if (v.state) host.workspace.setActiveState(v.state);
  else if (v.binary && v.bytes) host.workspace.setActiveBytes(v.bytes);
  else host.workspace.setActiveText(v.text);
}

async function renderDiff(area: HTMLElement, fromText: string, toText: string): Promise<void> {
  const { diffLines } = await import("diff");
  const parts = diffLines(fromText, toText);
  area.textContent = "";
  if (!parts.some((p) => p.added || p.removed)) {
    area.append(el("div", "ot-diff-line ctx", t("history.noDifferences")));
    return;
  }
  for (const part of parts) {
    const cls = part.added ? "add" : part.removed ? "del" : "ctx";
    const prefix = part.added ? "+ " : part.removed ? "- " : "  ";
    for (const line of part.value.replace(/\n$/, "").split("\n")) {
      area.append(el("div", `ot-diff-line ${cls}`, prefix + line));
    }
  }
}

function renderList(
  list: HTMLElement,
  versions: Version[],
  host: HostAPI,
  store: VersionStore,
  refresh: () => void,
): void {
  list.textContent = "";
  if (versions.length === 0) {
    list.append(el("div", "ot-hist-empty", t("history.empty")));
    return;
  }
  for (const v of versions) {
    const row = el("div", "ot-hist-row");
    const meta = el("div", "ot-hist-meta");
    const cnt = v.stateChanges ?? 0;
    const size = v.state
      ? t("history.changes", { n: cnt, count: cnt })
      : v.binary
        ? t("history.bytes", { n: (v.bytes?.length ?? 0).toLocaleString(getLocale()) })
        : t("history.chars", { n: v.text.length });
    meta.append(
      el("span", "ot-hist-time", new Date(v.ts).toLocaleString(getLocale())),
      el("span", "ot-hist-label", labelText(v.label)),
      el("span", "ot-hist-size", size),
    );
    row.append(meta);

    const actions = el("div", "ot-hist-actions");
    const diffArea = el("div", "ot-diff");
    diffArea.hidden = true;
    // Binary documents have no text to diff; offer Restore only.
    if (!v.binary) {
      const diffBtn = button(t("history.diffVsCurrent"), () => {
        diffArea.hidden = !diffArea.hidden;
        if (!diffArea.hidden) {
          const cur = host.workspace.getActiveDocument()?.text ?? "";
          void renderDiff(diffArea, v.text, cur);
        }
      });
      actions.append(diffBtn);
    }
    const restoreBtn = button(
      t("history.restore"),
      () => {
        void restoreVersion(host, store, v).then(() => {
          host.notifications.info(t("history.restored", { time: new Date(v.ts).toLocaleString(getLocale()) }));
          refresh();
        });
      },
      "ot-mini primary",
    );
    actions.append(restoreBtn);
    row.append(actions, diffArea);
    list.append(row);
  }
}

function openPanel(host: HostAPI, store: VersionStore): void {
  ensureStyles();
  host.ui.openPanel({
    title: t("history.title"),
    render: (container) => {
      const doc = host.workspace.getActiveDocument();
      if (!doc) {
        container.append(el("div", "ot-hist-empty", t("history.openDocFirst")));
        return;
      }
      const rootEl = el("div", "ot-hist");
      const bar = el("div", "ot-hist-bar");
      const list = el("div", "ot-hist-list");
      const refresh = (): void => {
        list.textContent = t("history.loading");
        void store.listByKey(doc.key).then((versions) => renderList(list, versions, host, store, refresh));
      };
      bar.append(
        button(t("history.snapshotNow"), () => {
          void snapshot(host, store, "Manual").then(refresh);
        }),
      );
      rootEl.append(bar, list);
      container.append(rootEl);
      refresh();
    },
  });
}

/**
 * When to take an automatic snapshot. A plain debounce answers "the user stopped typing",
 * but never fires while they keep going, so it must be paired with a deadline that does.
 *
 * Timers are tied to the session that armed them: snapshot() reads whatever document is
 * active, so one left over from a document the user has navigated away from would capture
 * the wrong one. Exported so the policy is testable without a browser.
 */
export class AutoSnapshotTimer {
  private quiet: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private sessionId: string | null = null;

  constructor(
    private readonly fire: () => void,
    private readonly quietMs = AUTO_SNAPSHOT_MS,
    private readonly maxMs = AUTO_SNAPSHOT_MAX_MS,
  ) {}

  /** A document was edited: restart the quiet period, and start the deadline if idle. */
  noteChange(sessionId: string): void {
    if (sessionId !== this.sessionId) this.reset(sessionId);
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.run(), this.quietMs);
    this.deadline ??= setTimeout(() => this.run(), this.maxMs);
  }

  /** A different document became active: anything pending was for the old one. */
  reset(sessionId: string | null): void {
    this.cancel();
    this.sessionId = sessionId;
  }

  cancel(): void {
    clearTimeout(this.quiet);
    clearTimeout(this.deadline);
    this.quiet = this.deadline = undefined;
  }

  private run(): void {
    this.cancel();
    this.fire();
  }
}

export const historyTool: ToolModule = {
  manifest: { kind: "tool", id: "history", capabilities: ["history", "diff"] },
  activate(host: HostAPI): Disposable {
    const store = new VersionStore();
    void store.pruneStale().catch(() => undefined); // months-old histories go at boot
    const auto = new AutoSnapshotTimer(() => void snapshot(host, store, "Auto"));
    const disposables = [
      // Baseline: snapshot the pristine document on open so the original is always restorable.
      host.events.on("documentOpened", ({ sessionId }) => {
        auto.reset(sessionId);
        void snapshot(host, store, "Opened");
      }),
      host.events.on("documentSaved", () => void snapshot(host, store, "Saved")),
      host.events.on("contentChanged", ({ sessionId }) => auto.noteChange(sessionId)),
      host.commands.register({
        id: "history.open",
        title: t("history.title"),
        run: () => openPanel(host, store),
      }),
      host.ui.addToolbarButton({
        id: "history",
        title: t("app.history"),
        hideWhenReadOnly: true, // nothing to version on a document that cannot be edited
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>`,
        onClick: () => openPanel(host, store),
      }),
    ];
    return {
      dispose() {
        auto.cancel();
        for (const d of disposables) d.dispose();
      },
    };
  },
};
