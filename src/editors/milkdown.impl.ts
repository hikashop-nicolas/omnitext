import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

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
  s.textContent = `
    .ot-milkdown { height: 100%; overflow: auto; background: var(--canvas); }
    .ot-milkdown .milkdown { height: 100%; }
  `;
  document.head.appendChild(s);
}

class MilkdownInstance implements EditorInstance {
  private crepe: Crepe | null = null;
  private ready = false;
  private edited = false;
  private originalText = "";
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.originalText = ctx.text;
    const root = document.createElement("div");
    root.className = "ot-milkdown";
    container.appendChild(root);
    this.root = root;

    const crepe = new Crepe({ root, defaultValue: ctx.text });
    crepe.on((listener) => {
      listener.markdownUpdated(() => {
        if (!this.ready) return; // ignore changes emitted during creation
        this.edited = true;
        ctx.onChange();
      });
    });
    this.crepe = crepe;
    crepe
      .create()
      .then(() => {
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
