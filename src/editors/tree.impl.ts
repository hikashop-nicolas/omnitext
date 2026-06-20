import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
  TreeView,
} from "../core/types";

// Tree editor for structured data (JSON/JSON5/YAML). It asks the format for a "tree"
// view (a parsed value + a stringify fn), renders an editable collapsible tree, and
// edits the value in place. Supports editing leaf values, renaming object keys,
// adding/removing object fields and array items, and turning a leaf into a nested
// object/array (type a JSON value like [] or {} into the field). getText returns the
// original text byte-for-byte until something is edited, then the format's stringify
// (which reformats) - an explicitly-lossy convenience view.

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
    .ot-tree .ot-row { display: flex; align-items: center; gap: 6px; margin: 3px 0 3px 14px; }
    .ot-tree .ot-key { color: var(--muted); }
    .ot-tree input {
      border: 1px solid var(--border); background: transparent; color: var(--text);
      font: inherit; padding: 2px 7px; border-radius: 5px;
    }
    .ot-tree input.ot-leaf { min-width: 120px; }
    .ot-tree input.ot-keyinput { min-width: 70px; width: auto; color: var(--text); }
    .ot-tree input:focus { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
    .ot-tree .ot-del {
      border: 0; background: transparent; color: var(--muted); cursor: pointer;
      font-size: 15px; line-height: 1; padding: 0 5px; border-radius: 4px;
    }
    .ot-tree .ot-del:hover { color: #e5484d; background: var(--surface); }
    .ot-tree .ot-add {
      border: 1px dashed var(--border); background: transparent; color: var(--muted);
      cursor: pointer; font: inherit; font-size: 12px; padding: 2px 9px; border-radius: 6px;
    }
    .ot-tree .ot-add:hover { border-color: var(--accent); color: var(--text); }
    .ot-tree .ot-addrow { margin-left: 14px; }
    .ot-tree-error { padding: 16px; color: var(--muted); }
  `;
  document.head.appendChild(s);
}

const isContainer = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object";

/** Parse to a primitive if possible (for live keystroke updates); else keep as string. */
function parsePrimitive(s: string): unknown {
  try {
    const v: unknown = JSON.parse(s);
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) return v;
  } catch {
    /* not a primitive */
  }
  return s;
}

/** Parse any JSON value (incl objects/arrays) on commit; else keep as string. */
function parseAny(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

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
    try {
      const view = fmt.toView(fmt.parse(ctx.text).model, "tree") as TreeView;
      this.value = view.value;
      this.stringify = view.stringify;
    } catch (err) {
      const e = document.createElement("div");
      e.className = "ot-tree-error";
      e.textContent = `Cannot show tree: ${err instanceof Error ? err.message : String(err)}`;
      container.appendChild(e);
      this.wrap = e;
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "ot-tree";
    container.appendChild(wrap);
    this.wrap = wrap;
    this.render();
  }

  private render(): void {
    if (!this.wrap) return;
    this.wrap.textContent = "";
    this.wrap.appendChild(
      isContainer(this.value)
        ? this.buildContainer(this.value)
        : this.buildLeaf(this.value, (v) => {
            this.value = v;
          }),
    );
  }

  private buildContainer(obj: Record<string, unknown>): HTMLElement {
    const isArray = Array.isArray(obj);
    const details = document.createElement("details");
    details.open = true;
    const keys = Object.keys(obj);
    const summary = document.createElement("summary");
    summary.textContent = isArray ? `[ ] ${keys.length} items` : `{ } ${keys.length} keys`;
    details.appendChild(summary);

    for (const key of keys) {
      const row = document.createElement("div");
      row.className = "ot-row";

      if (isArray) {
        const idx = document.createElement("span");
        idx.className = "ot-key";
        idx.textContent = `${key}:`;
        row.appendChild(idx);
      } else {
        const keyInput = document.createElement("input");
        keyInput.className = "ot-keyinput";
        keyInput.value = key;
        keyInput.addEventListener("change", () => this.renameKey(obj, key, keyInput.value));
        row.appendChild(keyInput);
        const colon = document.createElement("span");
        colon.className = "ot-key";
        colon.textContent = ":";
        row.appendChild(colon);
      }

      const child = obj[key];
      if (isContainer(child)) {
        row.appendChild(this.buildContainer(child));
      } else {
        row.appendChild(this.buildLeaf(child, (v) => (obj[key] = v)));
      }

      const del = document.createElement("button");
      del.className = "ot-del";
      del.textContent = "×";
      del.title = "Remove";
      del.addEventListener("click", () => this.removeEntry(obj, key, isArray));
      row.appendChild(del);
      details.appendChild(row);
    }

    const addRow = document.createElement("div");
    addRow.className = "ot-row ot-addrow";
    const addBtn = document.createElement("button");
    addBtn.className = "ot-add";
    addBtn.textContent = isArray ? "+ item" : "+ field";
    addBtn.addEventListener("click", () => this.addEntry(obj, isArray));
    addRow.appendChild(addBtn);
    details.appendChild(addRow);

    return details;
  }

  private buildLeaf(value: unknown, set: (v: unknown) => void): HTMLElement {
    const input = document.createElement("input");
    input.className = "ot-leaf";
    input.value = value === null ? "null" : String(value);
    input.addEventListener("input", () => {
      set(parsePrimitive(input.value));
      this.markDirty();
    });
    // On commit, allow turning a leaf into a nested object/array (type [] or {}).
    input.addEventListener("change", () => {
      const parsed = parseAny(input.value);
      set(parsed);
      this.markDirty();
      if (isContainer(parsed)) this.render();
    });
    return input;
  }

  private renameKey(obj: Record<string, unknown>, oldKey: string, newKey: string): void {
    if (newKey === oldKey || newKey === "") {
      this.render();
      return;
    }
    const entries = Object.entries(obj);
    for (const k of Object.keys(obj)) delete obj[k];
    for (const [k, v] of entries) obj[k === oldKey ? newKey : k] = v;
    this.markDirty();
    this.render();
  }

  private removeEntry(obj: Record<string, unknown>, key: string, isArray: boolean): void {
    if (isArray) (obj as unknown as unknown[]).splice(Number(key), 1);
    else delete obj[key];
    this.markDirty();
    this.render();
  }

  private addEntry(obj: Record<string, unknown>, isArray: boolean): void {
    if (isArray) {
      (obj as unknown as unknown[]).push("");
    } else {
      let key = "field";
      let n = 1;
      while (key in obj) key = `field${n++}`;
      obj[key] = "";
    }
    this.markDirty();
    this.render();
  }

  private markDirty(): void {
    this.dirty = true;
    this.notifyChange();
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
