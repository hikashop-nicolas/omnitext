import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// The frame theme ships separate light/dark stylesheets; load the one matching the OS
// scheme so the editor doesn't render white-on-dark. Dynamic imports keep both lazy.
const prefersDark = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function loadTheme(): void {
  if (prefersDark()) void import("@milkdown/crepe/theme/frame-dark.css");
  else void import("@milkdown/crepe/theme/frame.css");
}

// Markdown WYSIWYG editor (lazy-loaded), built on Milkdown's Crepe (batteries-included
// editor with toolbar + theme). It reformats Markdown on edit, so getText returns the
// original text until the user actually edits (we ignore changes during creation), and
// the byte-exact text editor + read-only preview stay available. Crepe creates
// asynchronously; getText falls back to the source until it is ready.

const STYLE_ID = "omnitext-milkdown-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  // Re-map Crepe's color tokens to the app palette (which already adapts to light/dark),
  // so the editor has crisp contrast and matches the rest of the UI in both themes.
  s.textContent = `
    .ot-milkdown { height: 100%; overflow: auto; background: var(--canvas); }
    .ot-milkdown .milkdown {
      height: 100%;
      --crepe-color-background: var(--canvas);
      --crepe-color-on-background: var(--text);
      --crepe-color-surface: var(--chrome);
      --crepe-color-surface-low: var(--surface);
      --crepe-color-on-surface: var(--text);
      --crepe-color-on-surface-variant: var(--muted);
      /* Crepe colors toolbar/handle/menu icons with --crepe-color-outline, so it must
         be visible, not the subtle border tone. */
      --crepe-color-outline: var(--muted);
      --crepe-color-primary: var(--accent);
      --crepe-color-secondary: var(--surface);
      --crepe-color-on-secondary: var(--text);
      --crepe-color-hover: var(--surface-hover);
      --crepe-color-selected: var(--surface);
      --crepe-color-inline-code: var(--text);
      --crepe-color-inline-area: var(--surface);
    }
    .ot-milkdown .milkdown .ProseMirror { color: var(--text); }
    /* The theme pads the page 60px 120px, sized for a desktop window. On a phone that left about
       190px of a 432px screen for text, under 42px headings. Keep room on the left for the block
       handle, and bring the headings down to phone size. */
    @media (max-width: 600px) {
      .ot-milkdown .milkdown .ProseMirror { padding: 20px 16px 48px 40px; }
      .ot-milkdown .milkdown .ProseMirror h1 { font-size: 30px; }
      .ot-milkdown .milkdown .ProseMirror h2 { font-size: 24px; }
      .ot-milkdown .milkdown .ProseMirror h3 { font-size: 20px; }
    }
  `;
  document.head.appendChild(s);
}

class MilkdownInstance implements EditorInstance {
  private crepe: Crepe | null = null;
  private ready = false;
  private edited = false;
  private originalText = "";
  /** The markdown as the editor itself writes the loaded document, once it is ready. */
  private baseline: string | null = null;
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    loadTheme();
    this.originalText = ctx.text;
    const root = document.createElement("div");
    root.className = "ot-milkdown";
    container.appendChild(root);
    this.root = root;

    const crepe = new Crepe({ root, defaultValue: ctx.text });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (!this.ready) return; // ignore changes emitted during creation
        // Opening a file is not an edit. The editor re-serializes what it loaded ("-" bullets,
        // table spacing) and reports that as an update, which marked every opened Markdown file
        // as having unsaved changes. Only a difference from its own first rendering counts.
        if (markdown === this.baseline) return;
        this.edited = true;
        ctx.onChange();
      });
    });
    this.crepe = crepe;
    crepe
      .create()
      .then(() => {
        this.baseline = crepe.getMarkdown();
        this.ready = true;
      })
      .catch((e: unknown) => console.error("milkdown create failed", e));
  }

  getText(): string {
    return this.edited && this.crepe ? this.crepe.getMarkdown() : this.originalText;
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.root?.querySelector<HTMLElement>(".milkdown [contenteditable]")?.focus();
  }

  dispose(): void {
    this.crepe?.destroy().catch(() => {});
    this.crepe = null;
    this.root?.remove();
    this.root = null;
  }
}

export const milkdownEditor: EditorModule = {
  create: () => new MilkdownInstance(),
};
