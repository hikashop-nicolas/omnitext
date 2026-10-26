// Small dialogs the PDF editor opens over itself: a line or paragraph of text, a form of
// labelled fields, and a pad to draw a signature on. Each one resolves to what was entered, or
// to null when it is dismissed, and removes itself either way.

import { createDocumentNative, isNative, writeDocumentNative } from "../core/platform";

const STYLE_ID = "omnitext-pdfcraft-tools-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pcd { position:absolute; inset:0; z-index:30; display:flex; align-items:center; justify-content:center; padding:12px;
      background:rgba(0,0,0,.45); }
    .ot-pcd-card { box-sizing:border-box; width:min(440px, 100%); max-height:100%; overflow:auto; display:flex; flex-direction:column; gap:10px;
      padding:14px; border-radius:12px; background:var(--surface); color:var(--text); border:1px solid var(--border);
      box-shadow:0 8px 28px rgba(0,0,0,.45); font:14px system-ui, sans-serif; }
    .ot-pcd-title { margin:0; font:600 16px system-ui, sans-serif; }
    .ot-pcd-row { display:flex; flex-direction:column; gap:4px; }
    .ot-pcd-row.check { flex-direction:row; align-items:center; gap:8px; }
    .ot-pcd-row label { color:var(--muted); font-size:12px; }
    .ot-pcd-row.check label { color:var(--text); font-size:14px; }
    .ot-pcd-card input:not([type=checkbox]), .ot-pcd-card textarea, .ot-pcd-card select { box-sizing:border-box; width:100%; font:inherit; padding:7px 9px;
      color:var(--text); background:var(--canvas); border:1px solid var(--border); border-radius:8px; }
    .ot-pcd-card textarea { min-height:90px; resize:vertical; }
    .ot-pcd-actions { display:flex; justify-content:flex-end; gap:8px; }
    .ot-pcd-pad { width:100%; height:180px; touch-action:none; background:#fff; border:1px solid var(--border); border-radius:8px; cursor:crosshair; }
    .ot-pcd-note { color:var(--muted); font-size:12px; white-space:pre-wrap; }
  `;
  document.head.appendChild(s);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Shell {
  card: HTMLElement;
  actions: HTMLElement;
  close(): void;
}

/** A modal card over `root`; Escape or a tap on the backdrop dismisses it through `onCancel`. */
function shell(root: HTMLElement, title: string, onCancel: () => void): Shell {
  ensureStyles();
  const back = el("div", "ot-pcd");
  const card = el("div", "ot-pcd-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", title);
  card.appendChild(el("h2", "ot-pcd-title", title));
  const actions = el("div", "ot-pcd-actions");
  back.appendChild(card);
  root.appendChild(back);
  back.addEventListener("pointerdown", (e) => {
    if (e.target === back) onCancel();
  });
  back.addEventListener("keydown", (e) => {
    if (e.key === "Escape") onCancel();
  });
  return { card, actions, close: () => back.remove() };
}

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = el("button", primary ? "btn primary" : "btn", label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export type Field =
  | { key: string; label: string; kind: "text" | "password"; value?: string; placeholder?: string }
  | { key: string; label: string; kind: "number"; value?: number; min?: number; max?: number }
  | { key: string; label: string; kind: "textarea"; value?: string; placeholder?: string }
  | { key: string; label: string; kind: "check"; value?: boolean }
  | { key: string; label: string; kind: "select"; value?: string; options: [value: string, label: string][] }
  | { key: string; label: string; kind: "file"; accept?: string };

export type Values = Record<string, string | number | boolean | File | null>;

export interface FormOptions {
  title: string;
  fields: Field[];
  ok: string;
  cancel: string;
  /** A line under the fields, for what they are about. */
  note?: string;
  /** Returns a message to show and keep the dialog open, or null to accept the values. */
  validate?(values: Values): string | null;
}

/** Asks for several values at once. */
export function formDialog(root: HTMLElement, options: FormOptions): Promise<Values | null> {
  return new Promise((resolve) => {
    const done = (v: Values | null): void => {
      s.close();
      resolve(v);
    };
    const s = shell(root, options.title, () => done(null));
    const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
    let first: HTMLElement | null = null;
    for (const f of options.fields) {
      const row = el("div", f.kind === "check" ? "ot-pcd-row check" : "ot-pcd-row");
      const id = `ot-pcd-${f.key}`;
      const label = el("label", undefined, f.label);
      label.htmlFor = id;
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (f.kind === "textarea") {
        input = el("textarea");
        input.value = f.value ?? "";
        input.placeholder = f.placeholder ?? "";
      } else if (f.kind === "select") {
        input = el("select");
        for (const [value, text] of f.options) input.add(new Option(text, value, false, value === f.value));
      } else {
        input = el("input");
        input.type = f.kind === "check" ? "checkbox" : f.kind === "file" ? "file" : f.kind;
        if (f.kind === "check") input.checked = !!f.value;
        else if (f.kind === "number") {
          input.value = String(f.value ?? "");
          if (f.min !== undefined) input.min = String(f.min);
          if (f.max !== undefined) input.max = String(f.max);
        } else if (f.kind === "file") {
          if (f.accept) input.accept = f.accept;
        } else {
          input.value = f.value ?? "";
          input.placeholder = f.placeholder ?? "";
          input.autocomplete = f.kind === "password" ? "new-password" : "off";
        }
      }
      input.id = id;
      inputs.set(f.key, input);
      if (f.kind === "check") row.append(input, label);
      else row.append(label, input);
      s.card.appendChild(row);
      first ??= input;
    }
    if (options.note) s.card.appendChild(el("div", "ot-pcd-note", options.note));
    const problem = el("div", "ot-pcd-note");
    problem.setAttribute("role", "alert");
    s.card.appendChild(problem);
    const collect = (): Values => {
      const out: Values = {};
      for (const f of options.fields) {
        const i = inputs.get(f.key)!;
        if (f.kind === "check") out[f.key] = (i as HTMLInputElement).checked;
        else if (f.kind === "file") out[f.key] = (i as HTMLInputElement).files?.[0] ?? null;
        else if (f.kind === "number") out[f.key] = Number(i.value);
        else out[f.key] = i.value;
      }
      return out;
    };
    const accept = (): void => {
      const values = collect();
      const message = options.validate?.(values) ?? null;
      if (message) problem.textContent = message;
      else done(values);
    };
    s.actions.append(button(options.cancel, false, () => done(null)), button(options.ok, true, accept));
    s.card.appendChild(s.actions);
    s.card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "file") {
        e.preventDefault();
        accept();
      }
    });
    first?.focus();
  });
}

/** Asks for some text: a line, or a paragraph when `multiline`. */
export async function askText(root: HTMLElement, o: { title: string; value?: string; multiline?: boolean; ok: string; cancel: string; label: string }): Promise<string | null> {
  const values = await formDialog(root, { title: o.title, ok: o.ok, cancel: o.cancel, fields: [{ key: "text", label: o.label, kind: o.multiline ? "textarea" : "text", value: o.value }] });
  return values ? String(values.text) : null;
}

export interface DrawnSignature {
  /** Strokes with both coordinates from 0 to 1, y down, scaled to the pad's width. */
  strokes: [number, number][][];
  /** The drawing's height over its width, so it can be placed without being squashed. */
  ratio: number;
}

/** A pad to draw a signature on; the strokes are trimmed to what was drawn. */
export function signaturePad(root: HTMLElement, o: { title: string; ok: string; cancel: string; clear: string; hint: string }): Promise<DrawnSignature | null> {
  return new Promise((resolve) => {
    const done = (v: DrawnSignature | null): void => {
      s.close();
      resolve(v);
    };
    const s = shell(root, o.title, () => done(null));
    const canvas = el("canvas", "ot-pcd-pad");
    canvas.setAttribute("aria-label", o.title);
    s.card.append(canvas, el("div", "ot-pcd-note", o.hint));
    const strokes: [number, number][][] = [];
    let current: [number, number][] | null = null;
    const draw = (): void => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 3 * (canvas.width / canvas.clientWidth || 1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111";
      for (const stroke of strokes) {
        ctx.beginPath();
        stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (stroke.length === 1) ctx.lineTo(stroke[0]![0] + 0.1, stroke[0]![1]);
        ctx.stroke();
      }
    };
    const resize = (): void => {
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      draw();
    };
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      current = [at(e)];
      strokes.push(current);
      draw();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!current) return;
      current.push(at(e));
      draw();
    });
    const end = (): void => {
      current = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    s.actions.append(
      button(o.cancel, false, () => done(null)),
      button(o.clear, false, () => {
        strokes.length = 0;
        draw();
      }),
      button(o.ok, true, () => {
        const pts = strokes.flat();
        if (!pts.length) return;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const w = Math.max(1, x1 - x0);
        const h = Math.max(1, y1 - y0);
        done({ strokes: strokes.map((st) => st.map(([x, y]) => [(x - x0) / w, (y - y0) / w] as [number, number])), ratio: h / w });
      }),
    );
    s.card.appendChild(s.actions);
    requestAnimationFrame(resize);
  });
}

/** Saves a file the person asked for: through the system picker in the app, as a download in a browser. */
export async function saveFile(bytes: Uint8Array, name: string, mime: string): Promise<boolean> {
  if (isNative()) {
    const picked = await createDocumentNative(name, mime);
    if (!picked) return false;
    await writeDocumentNative(picked.uri, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
