import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
  TreeView,
} from "../core/types";

// Tree editor for structured data (JSON/JSON5/YAML). It asks the format for a "tree"
// view (a parsed value plus a stringify function), renders a collapsible tree with
// editable leaf values, and edits the value in place. getText returns the original
// text byte-for-byte until something is edited, then the format's stringify (which
// reformats the document) - an explicitly-lossy convenience view.

const STYLE_ID = "omnitext-tree-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-tree {
      height: 100%; overflow: auto; background: var(--canvas); padding: 14px 18px;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .ot-tree details { margin-left: 14px; }
    .ot-tree > details { margin-left: 0; }
    .ot-tree summary { cursor: pointer; color: var(--muted); }
    .ot-tree .ot-row { display: flex; align-items: center; gap: 8px; margin: 3px 0 3px 14px; }
    .ot-tree .ot-key { color: var(--muted); }
    .ot-tree input {
      border: 1px solid var(--border); background: transparent; color: var(--text);
      font: inherit; padding: 2px 7px; border-radius: 5px; min-width: 120px;
    }
    .ot-tree input:focus { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
    .ot-tree-error { padding: 16px; color: var(--muted); }
  `;
  document.head.appendChild(s);
}

function parseLeaf(s: string): unknown {
  try {
    const v: unknown = JSON.parse(s);
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) return v;
  } catch {
    /* not a JSON primitive; keep as string */
  }
  return s;
}

const isContainer = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object";

class TreeInstance implements EditorInstance {
  private value: unknown = null;
  private stringify: (v: unknown) => string = (v) => JSON.stringify(v, null, 2);
  private originalText = "";
  private dirty = false;
  private notifyChange: () => void = () => {};
  private wrap: HTMLElement | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyles();
    this.originalText = ctx.text;
    this.notifyChange = ctx.onChange;

    const fmt = ctx.format;
    if (!fmt?.toView) {
      container.textContent = "No tree view available for this format.";
      return;
    }
    let view: TreeView;
    try {
      view = fmt.toView(fmt.parse(ctx.text).model, "tree") as TreeView;
    } catch (err) {
      const e = document.createElement("div");
      e.className = "ot-tree-error";
      e.textContent = `Cannot show tree: ${err instanceof Error ? err.message : String(err)}`;
      container.appendChild(e);
      this.wrap = e;
      return;
    }
    this.value = view.value;
    this.stringify = view.stringify;

    const wrap = document.createElement("div");
    wrap.className = "ot-tree";
    wrap.appendChild(
      isContainer(this.value)
        ? this.renderContainer(this.value)
        : this.renderLeaf(this.value, (v) => {
            this.value = v;
          }),
    );
    container.appendChild(wrap);
    this.wrap = wrap;
  }

  private renderContainer(obj: Record<string, unknown>): HTMLElement {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    const keys = Object.keys(obj);
    summary.textContent = Array.isArray(obj)
      ? `[ ] ${keys.length} items`
      : `{ } ${keys.length} keys`;
    details.appendChild(summary);

    for (const key of keys) {
      const row = document.createElement("div");
      row.className = "ot-row";
      const keyEl = document.createElement("span");
      keyEl.className = "ot-key";
      keyEl.textContent = `${key}:`;
      row.appendChild(keyEl);

      const child = obj[key];
      if (isContainer(child)) {
        row.appendChild(this.renderContainer(child));
      } else {
        row.appendChild(
          this.renderLeaf(child, (v) => {
            obj[key] = v;
          }),
        );
      }
      details.appendChild(row);
    }
    return details;
  }

  private renderLeaf(value: unknown, set: (v: unknown) => void): HTMLElement {
    const input = document.createElement("input");
    input.value = value === null ? "null" : String(value);
    input.addEventListener("input", () => {
      set(parseLeaf(input.value));
      this.dirty = true;
      this.notifyChange();
    });
    return input;
  }

  getText(): string {
    return this.dirty ? this.stringify(this.value) : this.originalText;
  }

  selection(): unknown {
    return null;
  }

  focus(): void {
    this.wrap?.querySelector("input")?.focus();
  }

  dispose(): void {
    this.wrap?.remove();
    this.wrap = null;
  }
}

export const treeEditor: EditorModule = {
  create: () => new TreeInstance(),
};
