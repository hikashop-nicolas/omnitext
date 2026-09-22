import type {
  EditorInstance,
  EditorModule,
  EditorMountContext,
  TreeView,
} from "../core/types";
import { t } from "../i18n";

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
      height: 100%; overflow: auto; background: var(--canvas); color: var(--text); padding: 14px 18px;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      /* Borders mixed from the text colour stay visible on both themes; the theme's own
         --border is tuned for panels and all but vanishes against the dark canvas. */
      --ot-line: color-mix(in srgb, var(--text) 24%, transparent);
    }
    .ot-tree .ot-head, .ot-tree .ot-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
    .ot-tree .ot-kids { margin-left: 22px; padding-left: 10px; border-left: 1px solid var(--ot-line); }
    .ot-tree .ot-kids[hidden] { display: none; }
    .ot-tree .ot-toggle {
      width: 18px; height: 18px; flex: 0 0 18px; padding: 0; border: 0; border-radius: 4px;
      background: transparent; color: var(--muted); cursor: pointer; font-size: 11px; line-height: 18px;
    }
    .ot-tree .ot-toggle:hover { background: var(--surface-hover); color: var(--text); }
    .ot-tree .ot-spacer { width: 18px; flex: 0 0 18px; }
    .ot-tree .ot-type { color: var(--muted); }
    .ot-tree select.ot-kind {
      font: inherit; font-size: 12px; padding: 1px 2px; border-radius: 5px; cursor: pointer;
      border: 1px solid var(--ot-line); background: var(--surface); color: var(--muted);
    }
    .ot-tree select.ot-kind:hover { color: var(--text); }
    .ot-tree .ot-key { color: var(--muted); }
    .ot-tree input {
      border: 1px solid var(--ot-line); background: var(--surface); color: var(--text);
      font: inherit; padding: 2px 7px; border-radius: 5px;
    }
    .ot-tree input.ot-leaf { min-width: 160px; }
    .ot-tree input.ot-keyinput { min-width: 90px; width: auto; color: var(--accent); }
    .ot-tree input:hover { border-color: color-mix(in srgb, var(--text) 45%, transparent); }
    .ot-tree input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .ot-tree .ot-del {
      border: 0; background: transparent; color: var(--muted); cursor: pointer;
      font-size: 15px; line-height: 1; padding: 2px 6px; border-radius: 4px;
    }
    .ot-tree .ot-del:hover { color: #e5484d; background: var(--surface-hover); }
    .ot-tree .ot-add {
      border: 1px dashed var(--ot-line); background: transparent; color: var(--text);
      cursor: pointer; font: inherit; font-size: 12px; padding: 2px 10px; border-radius: 6px;
    }
    .ot-tree .ot-add:hover { border-color: var(--accent); color: var(--accent); }
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

export type Kind = "value" | "list" | "object";

export function kindOf(v: unknown): Kind {
  return Array.isArray(v) ? "list" : isContainer(v) ? "object" : "value";
}

/** Convert a value to another kind without losing data, or null when that would drop
 *  something (a list or object with several entries cannot become one value, and an
 *  object's keys would be lost as a list). */
export function convertKind(v: unknown, to: Kind): { value: unknown } | null {
  const from = kindOf(v);
  if (from === to) return { value: v };
  if (from === "value") {
    const empty = v === "";
    return { value: to === "list" ? (empty ? [] : [v]) : empty ? {} : { field: v } };
  }
  const entries = Object.values(v as Record<string, unknown>);
  if (to === "value") {
    if (entries.length === 0) return { value: "" };
    if (entries.length === 1 && !isContainer(entries[0])) return { value: entries[0] };
    return null;
  }
  if (to === "object") return { value: { ...(v as unknown[]) } }; // list indexes become keys
  return entries.length === 0 ? { value: [] } : null; // object -> list would drop the keys
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
      container.textContent = t("tree.unavailable");
      return;
    }
    try {
      const view = fmt.toView(fmt.parse(ctx.text).model, "tree") as TreeView;
      this.value = view.value;
      this.stringify = view.stringify;
    } catch (err) {
      const e = document.createElement("div");
      e.className = "ot-tree-error";
      e.textContent = t("tree.error", { error: err instanceof Error ? err.message : String(err) });
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
        ? this.buildNode(this.value, [], [])
        : this.buildLeaf(this.value, (v) => {
            this.value = v;
          }),
    );
  }

  /** One object/array: a header line (toggle, key, size, remove) with its entries indented
   *  beneath it, so a nested value reads under its key rather than beside it. Open by default. */
  private buildNode(obj: Record<string, unknown>, lead: HTMLElement[], trail: HTMLElement[]): HTMLElement {
    const isArray = Array.isArray(obj);
    const keys = Object.keys(obj);
    const node = document.createElement("div");
    const head = document.createElement("div");
    head.className = "ot-head";
    const kids = document.createElement("div");
    kids.className = "ot-kids";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ot-toggle";
    const setOpen = (open: boolean) => {
      kids.hidden = !open;
      toggle.textContent = open ? "▼" : "▶";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? t("tree.collapse") : t("tree.expand"));
    };
    toggle.addEventListener("click", () => setOpen(kids.hidden === true));
    setOpen(true);

    const type = document.createElement("span");
    type.className = "ot-type";
    const n = keys.length;
    type.textContent = isArray
      ? n === 1 ? t("tree.itemsOne") : t("tree.items", { n })
      : n === 1 ? t("tree.keysOne") : t("tree.keys", { n });
    head.append(toggle, ...lead, type, ...trail);

    for (const key of keys) {
      const keyEls: HTMLElement[] = [];
      if (isArray) {
        const idx = document.createElement("span");
        idx.className = "ot-key";
        idx.textContent = `${key}:`;
        keyEls.push(idx);
      } else {
        const keyInput = document.createElement("input");
        keyInput.className = "ot-keyinput";
        keyInput.value = key;
        keyInput.addEventListener("change", () => this.renameKey(obj, key, keyInput.value));
        const colon = document.createElement("span");
        colon.className = "ot-key";
        colon.textContent = ":";
        keyEls.push(keyInput, colon);
      }
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ot-del";
      del.textContent = "×";
      del.title = t("tree.remove");
      del.setAttribute("aria-label", t("tree.remove"));
      del.addEventListener("click", () => this.removeEntry(obj, key, isArray));

      const child = obj[key];
      if (isContainer(child)) {
        kids.appendChild(this.buildNode(child, [...keyEls, this.buildKind(obj, key)], [del]));
      } else {
        const row = document.createElement("div");
        row.className = "ot-row";
        const spacer = document.createElement("span");
        spacer.className = "ot-spacer"; // lines leaf keys up with the keys of nested nodes
        row.append(spacer, ...keyEls, this.buildKind(obj, key), this.buildLeaf(child, (v) => (obj[key] = v)), del);
        kids.appendChild(row);
      }
    }

    const addRow = document.createElement("div");
    addRow.className = "ot-row";
    const spacer = document.createElement("span");
    spacer.className = "ot-spacer";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ot-add";
    addBtn.textContent = isArray ? t("tree.addItem") : t("tree.addField");
    addBtn.addEventListener("click", () => this.addEntry(obj, isArray));
    addRow.append(spacer, addBtn);
    kids.appendChild(addRow);

    node.append(head, kids);
    return node;
  }

  /** Value / list / object picker for one entry; converts it in place. */
  private buildKind(parent: Record<string, unknown>, key: string): HTMLSelectElement {
    const current = parent[key];
    const sel = document.createElement("select");
    sel.className = "ot-kind";
    sel.title = t("tree.kind");
    sel.setAttribute("aria-label", t("tree.kind"));
    const labels: Record<Kind, string> = { value: t("tree.kindValue"), list: t("tree.kindList"), object: t("tree.kindObject") };
    for (const kind of ["value", "list", "object"] as Kind[]) {
      const opt = document.createElement("option");
      opt.value = kind;
      opt.textContent = labels[kind];
      opt.selected = kind === kindOf(current);
      if (!convertKind(current, kind)) {
        opt.disabled = true;
        opt.title = t("tree.kindLocked");
      }
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      const next = convertKind(parent[key], sel.value as Kind);
      if (!next) return this.render();
      parent[key] = next.value;
      this.markDirty();
      this.render();
    });
    return sel;
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
