import { basicSetup } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Diagnostic as CmDiagnostic, linter, lintGutter } from "@codemirror/lint";
import { gotoLine } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import type * as Y from "yjs"; // types only: the adapter itself is loaded on demand
import type {
  CollabBinding,
  CollabContext,
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";
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
const fontTheme = (zoom: number): Extension => EditorView.theme({ "&": { fontSize: `${(BASE_FONT * zoom) / 100}px` } });

function savedZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z ? clampZoom(z) : 100;
  } catch {
    return 100;
  }
}

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
  private pinch: { dist: number; zoom: number } | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    const extensions: Extension[] = [
      basicSetup,
      baseTheme,
      EditorView.lineWrapping,
      this.collabSlot.of([]),
      this.zoomSlot.of(fontTheme(this.zoom)),
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

    this.view = new EditorView({
      parent: container,
      state: EditorState.create({ doc: ctx.text, extensions }),
    });
    this.buildBar();
    this.listenZoomGestures(this.view.scrollDOM);
  }

  /** Cursor position (a tap opens Go to line) and the text size slider, for the status bar. */
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
    bar.append(pos, range, pct);
    this.bar = bar;
    this.pos = pos;
    this.range = range;
    this.pct = pct;
    this.showPosition();
    this.showZoom();
  }

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

  /** Changes the text size, keeping the text under `anchor` (client coords) in place. */
  private setZoom(zoom: number, anchor?: { x: number; y: number }): void {
    const view = this.view;
    const z = clampZoom(zoom);
    if (!view || z === this.zoom) return;
    this.zoom = z;
    this.showZoom();
    const at = anchor ? view.posAtCoords(anchor, false) : null;
    view.dispatch({ effects: this.zoomSlot.reconfigure(fontTheme(z)) });
    if (anchor && at != null) {
      view.requestMeasure({
        read: (v) => v.coordsAtPos(at),
        write: (c, v) => {
          if (c) v.scrollDOM.scrollTop += c.top - anchor.y;
        },
      });
    }
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
    const span = (e: TouchEvent): number =>
      Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY) || 1;
    const mid = (e: TouchEvent): { x: number; y: number } => ({
      x: (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2,
      y: (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2,
    });
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) this.pinch = { dist: span(e), zoom: this.zoom };
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!this.pinch || e.touches.length !== 2) return;
      e.preventDefault();
      this.setZoom(this.pinch.zoom * (span(e) / this.pinch.dist), mid(e));
    }, { passive: false });
    const end = (e: TouchEvent): void => {
      if (!this.pinch || e.touches.length >= 2) return;
      this.pinch = null;
      this.saveZoom();
    };
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * Math.exp(-e.deltaY / 100), { x: e.clientX, y: e.clientY });
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
