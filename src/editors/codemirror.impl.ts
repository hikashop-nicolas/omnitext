import { basicSetup } from "codemirror";
import { Compartment, EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Diagnostic as CmDiagnostic, linter, lintGutter } from "@codemirror/lint";
import { closeSearchPanel, gotoLine, openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { findBar } from "./codemirror-find";
import { oneDark } from "@codemirror/theme-one-dark";
import type * as Y from "yjs"; // types only: the adapter itself is loaded on demand
import type {
  CollabBinding,
  CollabContext,
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";
import { isNative } from "../core/platform";
import { t } from "../i18n";

// The universal text editor (lazy-loaded). It consumes the "text" view, so it is the
// fallback for any format. It pulls optional syntax highlighting and diagnostics from
// the active format, keeping CodeMirror entirely out of the core.

/** The shared document's field name. Every peer must agree on it, so it is fixed here. */
const SHARED_TEXT = "codemirror";

// Comfortable typography and spacing, applied in both themes.
const baseTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { border: "none", background: "transparent" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 14px" },
});

// Text size: the font size at 100 %, the slider's range, and where the choice is remembered.
const BASE_FONT = 13.5;
const MIN_ZOOM = 50;
const MAX_ZOOM = 300;
const ZOOM_KEY = "omnitext:codeZoom";
const clampZoom = (z: number): number => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));
// On the scroller (text and gutters) only: the find bar and tooltips keep their size.
const fontTheme = (zoom: number): Extension => EditorView.theme({ ".cm-scroller": { fontSize: `${(BASE_FONT * zoom) / 100}px` } });

function savedZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z ? clampZoom(z) : 100;
  } catch {
    return 100;
  }
}

// Lucide-style outline icons, as on the app's toolbar.
const SEARCH_ICON = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>';
const FS_ICON = '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>';
const FS_EXIT_ICON = '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>';
const svgIcon = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// CodeMirror's own words (the search panel, Go to line), in the app's language.
const CM_PHRASES: [string, string][] = [
  ["Find", "find"],
  ["Replace", "replace"],
  ["next", "next"],
  ["previous", "previous"],
  ["all", "all"],
  ["match case", "matchCase"],
  ["regexp", "regexp"],
  ["by word", "byWord"],
  ["replace", "replaceOne"],
  ["replace all", "replaceAll"],
  ["close", "close"],
  ["Go to line", "goToLine"],
  ["go", "go"],
  ["current match", "currentMatch"],
  ["on line", "onLine"],
  ["replaced $ matches", "replacedMatches"],
  ["replaced match on line $", "replacedMatchOnLine"],
];
const phrases = (): Extension =>
  EditorState.phrases.of(Object.fromEntries(CM_PHRASES.map(([en, id]) => [en, t(`code.cm.${id}`)])));

const prefersDark = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

class CodeMirrorInstance implements EditorInstance {
  private view: EditorView | null = null;
  /** Holds the collaboration extension, so a session can start and end after mount. */
  private readonly collabSlot = new Compartment();
  private readonly zoomSlot = new Compartment();
  private zoom = savedZoom();
  private bar: HTMLElement | null = null;
  private pos: HTMLButtonElement | null = null;
  private range: HTMLInputElement | null = null;
  private pct: HTMLElement | null = null;
  private pinch: { dist: number; zoom: number; at: number; off: number } | null = null;
  private wrap: HTMLElement | null = null;
  private fsButton: HTMLButtonElement | null = null;
  /** Where the bar sat in the status bar, to put it back when fullscreen ends. */
  private barHome: { parent: Node; next: Node | null } | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    const extensions: Extension[] = [
      basicSetup,
      findBar(),
      baseTheme,
      EditorView.lineWrapping,
      this.collabSlot.of([]),
      this.zoomSlot.of(fontTheme(this.zoom)),
      phrases(),
      EditorView.updateListener.of((u) => {
        // Remote edits arrive as ordinary document changes, which is what we want: they
        // mark the document dirty and drive autosave exactly as typing does.
        if (u.docChanged) ctx.onChange();
        if (u.docChanged || u.selectionSet) this.showPosition();
      }),
    ];
    if (prefersDark()) extensions.push(oneDark);
    const langExt = ctx.format?.language?.();
    if (langExt) extensions.push(langExt as Extension);

    // Surface the format's diagnostics in the gutter. For text-model formats the
    // model is the text, so we pass the document text as both model and text.
    const fmt = ctx.format;
    if (fmt?.validate) {
      extensions.push(lintGutter());
      extensions.push(
        linter((view) => {
          const text = view.state.doc.toString();
          const len = text.length;
          return fmt.validate!(text, text).map((d): CmDiagnostic => {
            const from = Math.max(0, Math.min(d.from ?? 0, len));
            const to = Math.max(from, Math.min(d.to ?? from, len));
            return { from, to, severity: d.severity, message: d.message };
          });
        }),
      );
    }

    // A wrapper of our own, so fullscreen takes the bar along with the text.
    const wrap = document.createElement("div");
    wrap.className = "cm-wrap";
    container.appendChild(wrap);
    this.wrap = wrap;
    this.view = new EditorView({
      parent: wrap,
      state: EditorState.create({ doc: ctx.text, extensions }),
    });
    this.buildBar();
    this.listenZoomGestures(this.view.scrollDOM);
    document.addEventListener("fullscreenchange", this.onFullscreen);
  }

  /** Search, cursor position (a tap opens Go to line), text size and fullscreen, for the status bar. */
  private buildBar(): void {
    const bar = document.createElement("div");
    bar.className = "cm-statusbar";
    const pos = document.createElement("button");
    pos.type = "button";
    pos.className = "cm-statusbar-pos";
    pos.addEventListener("click", () => {
      if (this.view) gotoLine(this.view);
    });
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(MIN_ZOOM);
    range.max = String(MAX_ZOOM);
    range.step = "10";
    range.title = t("code.zoom");
    range.setAttribute("aria-label", t("code.zoom"));
    range.addEventListener("input", () => this.setZoom(Number(range.value)));
    range.addEventListener("change", () => this.saveZoom());
    const pct = document.createElement("span");
    pct.className = "cm-statusbar-pct";
    pct.setAttribute("aria-label", t("code.zoomPercent"));
    const search = this.iconButton(SEARCH_ICON, t("code.search"), () => {
      const v = this.view;
      if (!v) return;
      if (searchPanelOpen(v.state)) closeSearchPanel(v);
      else openSearchPanel(v);
    });
    const grow = document.createElement("span");
    grow.className = "cm-statusbar-grow";
    bar.append(search, pos, grow, range, pct);
    // Fullscreen exists where it works, the app, as in the other editors.
    if (isNative() && document.fullscreenEnabled) {
      this.fsButton = this.iconButton(FS_ICON, t("code.fullscreen"), () => void this.toggleFullscreen());
      bar.append(this.fsButton);
    }
    this.bar = bar;
    this.pos = pos;
    this.range = range;
    this.pct = pct;
    this.showPosition();
    this.showZoom();
  }

  private iconButton(svg: string, label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-statusbar-btn";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = svgIcon(svg);
    b.addEventListener("click", run);
    return b;
  }

  private toggleFullscreen(): Promise<void> {
    const wrap = this.wrap;
    if (!wrap) return Promise.resolve();
    if (document.fullscreenElement === wrap) return document.exitFullscreen().catch(() => undefined);
    return wrap.requestFullscreen?.().catch(() => undefined) ?? Promise.resolve();
  }

  /** In fullscreen the bar moves under the text, and goes back to the status bar after. */
  private onFullscreen = (): void => {
    const bar = this.bar;
    const wrap = this.wrap;
    if (!bar || !wrap) return;
    const on = document.fullscreenElement === wrap;
    if (on && bar.parentNode !== wrap) {
      if (bar.parentNode) this.barHome = { parent: bar.parentNode, next: bar.nextSibling };
      wrap.appendChild(bar);
    } else if (!on && bar.parentNode === wrap) {
      const home = this.barHome;
      if (home) home.parent.insertBefore(bar, home.next && home.next.parentNode === home.parent ? home.next : null);
      else bar.remove();
    }
    bar.classList.toggle("is-fs", on);
    const b = this.fsButton;
    if (b) {
      const label = t(on ? "code.exitFullscreen" : "code.fullscreen");
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = svgIcon(on ? FS_EXIT_ICON : FS_ICON);
    }
    this.view?.requestMeasure();
  };

  statusItems(): HTMLElement | null {
    return this.bar;
  }

  private showPosition(): void {
    const view = this.view;
    if (!view || !this.pos) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const vars = { line: line.number, col: head - line.from + 1 };
    this.pos.textContent = t("code.positionShort", vars);
    this.pos.title = t("code.position", vars);
  }

  private showZoom(): void {
    if (this.range) this.range.value = String(this.zoom);
    if (this.pct) this.pct.textContent = `${this.zoom}%`;
  }

  /**
   * Changes the text size. With an anchor, the character `at` ends up `off` pixels above
   * screen height `y` (off as measured at size `from`, scaled with the text), so the text
   * stays under the fingers or the pointer.
   */
  private setZoom(zoom: number, anchor?: { at: number; off: number; from: number; y: number }): void {
    const view = this.view;
    const z = clampZoom(zoom);
    // at a size limit a pinch still moves the text along with the fingers
    if (!view || (z === this.zoom && !anchor)) return;
    const effects: StateEffect<unknown>[] = [];
    if (z !== this.zoom) {
      this.zoom = z;
      this.showZoom();
      effects.push(this.zoomSlot.reconfigure(fontTheme(z)));
    }
    // CodeMirror places the character itself once the new size is laid out; a scroll set from
    // outside is undone by its own scroll anchoring.
    if (anchor) {
      const top = view.scrollDOM.getBoundingClientRect().top;
      const yMargin = anchor.y - top - (anchor.off * z) / anchor.from;
      effects.push(EditorView.scrollIntoView(anchor.at, { y: "start", yMargin }));
    }
    view.dispatch({ effects });
  }

  /** The character under a screen point, and how far below its top the point is. */
  private anchorAt(x: number, y: number): { at: number; off: number } | null {
    const view = this.view;
    if (!view) return null;
    const at = view.posAtCoords({ x, y }, false);
    const c = view.coordsAtPos(at);
    return c ? { at, off: y - c.top } : null;
  }

  private saveZoom(): void {
    try {
      localStorage.setItem(ZOOM_KEY, String(this.zoom));
    } catch {
      // private mode or storage off: the size lasts until the editor closes
    }
  }

  /** Two-finger pinch on touch screens, and Ctrl+wheel (a trackpad pinch) elsewhere. */
  private listenZoomGestures(el: HTMLElement): void {
    // Pointer events, captured by the scroller: a resize redraws the lines, and touch events
    // keep going to the line a finger first landed on, which by then is out of the page.
    const fingers = new Map<number, { x: number; y: number }>();
    const two = (): [{ x: number; y: number }, { x: number; y: number }] => {
      const [a, b] = [...fingers.values()];
      return [a!, b!];
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size !== 2) return;
      for (const id of fingers.keys()) {
        try {
          el.setPointerCapture(id);
        } catch {
          // a finger already lifted
        }
      }
      const [a, b] = two();
      const at = this.anchorAt((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = at ? { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom, ...at } : null;
    });
    el.addEventListener("pointermove", (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = this.pinch;
      if (!p || fingers.size !== 2) return;
      const [a, b] = two();
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.setZoom(p.zoom * (dist / p.dist), { at: p.at, off: p.off, from: p.zoom, y: (a.y + b.y) / 2 });
    });
    const lift = (e: PointerEvent): void => {
      if (!fingers.delete(e.pointerId) || !this.pinch || fingers.size >= 2) return;
      this.pinch = null;
      this.saveZoom();
    };
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lift);
    // The browser must not scroll or zoom the page under a pinch: claimed from the second finger on.
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length >= 2) e.preventDefault();
    }, { passive: false });
    el.addEventListener("touchmove", (e) => {
      if (this.pinch || e.touches.length >= 2) e.preventDefault();
    }, { passive: false });
    el.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const a = this.anchorAt(e.clientX, e.clientY);
      this.setZoom(this.zoom * Math.exp(-e.deltaY / 100), a ? { ...a, from: this.zoom, y: e.clientY } : undefined);
      this.saveZoom();
    }, { passive: false });
  }

  getText(): string {
    return this.view ? this.view.state.doc.toString() : "";
  }

  /**
   * The whole document as plain text for printing. CodeMirror keeps only the lines around
   * the viewport in the DOM (about twenty of them), and print takes the DOM as it finds it,
   * so printing the live surface yields the first page of any long file. Highlighting is
   * lost here, which is the trade for printing all of it.
   */
  printable(): HTMLElement | null {
    const pre = document.createElement("pre");
    pre.className = "print-text";
    pre.textContent = this.getText();
    return pre;
  }

  selection(): unknown {
    return this.view ? this.view.state.selection.main : null;
  }

  /**
   * Collaboration, via y-codemirror.next: a Y.Text mirrors the document and remote
   * cursors come from awareness. Loaded on demand, so a session's cost is paid only by
   * someone who starts one.
   */
  collab(): CollabBinding {
    return {
      bind: async (ctx: CollabContext) => {
        const view = this.view;
        if (!view) return;
        const { yCollab } = await import("y-codemirror.next");
        const ytext = ctx.doc.getText(SHARED_TEXT) as Y.Text;

        if (ctx.seed) {
          // Exactly one peer populates the shared document, from what is on screen.
          if (ytext.length === 0) ytext.insert(0, view.state.doc.toString());
        } else {
          // A joiner adopts the session's text wholesale. Done before the extension is
          // attached, so this replacement is not mirrored back as an edit of its own.
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: ytext.toString() },
          });
        }

        const extensions: Extension[] = [yCollab(ytext, ctx.awareness as never)];
        if (ctx.readOnly) extensions.push(EditorView.editable.of(false));
        view.dispatch({ effects: this.collabSlot.reconfigure(extensions) });
      },
      unbind: () => {
        this.view?.dispatch({ effects: this.collabSlot.reconfigure([]) });
      },
    };
  }

  focus(): void {
    this.view?.focus();
  }

  dispose(): void {
    document.removeEventListener("fullscreenchange", this.onFullscreen);
    if (this.wrap && document.fullscreenElement === this.wrap) void document.exitFullscreen().catch(() => undefined);
    this.wrap?.remove();
    this.wrap = null;
    this.bar?.remove();
    this.bar = null;
    this.view?.destroy();
    this.view = null;
  }
}

export const codemirrorEditor: EditorModule = {
  create(): EditorInstance {
    return new CodeMirrorInstance();
  },
};
