// Small DOM helpers and the icon set of the presentation editor.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Lucide-style outline icons (24 px grid, 2 px stroke), the same look as the rest of the app.
const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  select: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  shapes: '<rect width="9" height="9" x="3" y="3" rx="1"/><circle cx="17" cy="17" r="4.5"/><path d="m14 4 3.5 6h-7z" transform="translate(3.5 -1)"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  slideNew: '<rect width="18" height="14" x="3" y="3" rx="2"/><path d="M12 8v6"/><path d="M9 11h6"/><path d="M8 21h8"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  present: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/><path d="M11 8v6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  slides: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  notes: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
  larger: '<path d="m4 20 6-14 6 14"/><path d="M6 15h8"/><path d="M19 3v6"/><path d="M16 6h6"/>',
  smaller: '<path d="m4 20 6-14 6 14"/><path d="M6 15h8"/><path d="M16 6h6"/>',
  textColor: '<path d="m6 16 6-12 6 12"/><path d="M8.5 12h7"/>',
  fill: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
  line: '<path d="M4 20 20 4"/>',
  alignLeft: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
  alignCenter: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>',
  alignRight: '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>',
  bullets: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  toFront: '<rect width="8" height="8" x="14" y="14" rx="2"/><rect width="8" height="8" x="2" y="2" rx="2"/><path d="M7 14v1a2 2 0 0 0 2 2h1"/><path d="M14 7h1a2 2 0 0 1 2 2v1"/>',
  toBack: '<rect width="8" height="8" x="2" y="2" rx="2"/><rect width="8" height="8" x="14" y="14" rx="2"/><path d="M14 7h1a2 2 0 0 1 2 2v1"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  insert: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>',
  tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  spellcheck: '<path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** An icon button in the app's own button style. */
export function iconButton(name: IconName, title: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "btn icon");
  b.type = "button";
  b.innerHTML = icon(name);
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
}

export interface MenuItem {
  label: string;
  run(): void;
  /** Marks the current choice. */
  on?: boolean;
}

/** A small popup menu under `anchor`, closed by a click anywhere else or Escape. */
export function popupMenu(host: HTMLElement, anchor: HTMLElement, items: MenuItem[]): void {
  for (const old of host.querySelectorAll(".ot-px-menu")) old.remove();
  const menu = el("div", "ot-px-menu");
  menu.setAttribute("role", "menu");
  const close = (): void => {
    menu.remove();
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", esc, true);
  };
  const away = (e: Event): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  for (const item of items) {
    const b = el("button", item.on ? "on" : undefined, item.label);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => {
      close();
      item.run();
    });
    menu.appendChild(b);
  }
  host.appendChild(menu);
  const a = anchor.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(a.left - h.left, h.width - menu.offsetWidth - 4))}px`;
  menu.style.top = `${a.bottom - h.top + 4}px`;
  setTimeout(() => {
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
  }, 0);
}

export const PALETTE = ["#000000", "#595959", "#a6a6a6", "#ffffff", "#c00000", "#ed7d31", "#ffc000", "#92d050", "#00b050", "#00b0f0", "#0070c0", "#7030a0"];

/** A swatch popup; `pick` gets "#rrggbb", or null for "no colour" when `none` is a label. */
export function colorMenu(host: HTMLElement, anchor: HTMLElement, o: { none?: string; custom: string }, pick: (color: string | null) => void): void {
  for (const old of host.querySelectorAll(".ot-px-menu")) old.remove();
  const menu = el("div", "ot-px-menu ot-px-colors");
  const close = (): void => {
    menu.remove();
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", esc, true);
  };
  const away = (e: Event): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  const grid = el("div", "ot-px-swatches");
  for (const c of PALETTE) {
    const b = el("button", "ot-px-swatch");
    b.type = "button";
    b.style.background = c;
    b.title = c;
    b.setAttribute("aria-label", c);
    b.addEventListener("click", () => {
      close();
      pick(c);
    });
    grid.appendChild(b);
  }
  menu.appendChild(grid);
  const custom = el("label", "ot-px-custom", o.custom);
  const input = el("input");
  input.type = "color";
  input.addEventListener("change", () => {
    close();
    pick(input.value);
  });
  custom.appendChild(input);
  menu.appendChild(custom);
  if (o.none) {
    const none = el("button", undefined, o.none);
    none.type = "button";
    none.addEventListener("click", () => {
      close();
      pick(null);
    });
    menu.appendChild(none);
  }
  host.appendChild(menu);
  const a = anchor.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(a.left - h.left, h.width - menu.offsetWidth - 4))}px`;
  menu.style.top = `${a.bottom - h.top + 4}px`;
  setTimeout(() => {
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
  }, 0);
}

export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Keeps a toolbar to one row: what does not fit moves, in order, into a panel opened by a "more" button. */
export function overflowRow(host: HTMLElement, row: HTMLElement, items: () => HTMLElement[], label: string): { more: HTMLButtonElement; layout: () => void; close: () => void } {
  const panel = el("div", "ot-px-morepanel");
  panel.hidden = true;
  host.appendChild(panel);
  const more = iconButton("more", label, () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    const a = more.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    panel.style.left = `${Math.max(4, Math.min(a.left - h.left, h.width - panel.offsetWidth - 4))}px`;
    panel.style.top = `${a.bottom - h.top + 4}px`;
    setTimeout(() => document.addEventListener("pointerdown", away, true));
  });
  more.hidden = true;
  row.appendChild(more);
  const home = new Map<HTMLElement, HTMLElement>();
  const away = (e: Event): void => {
    if (!panel.contains(e.target as Node) && !more.contains(e.target as Node)) close();
  };
  function close(): void {
    panel.hidden = true;
    document.removeEventListener("pointerdown", away, true);
  }
  panel.addEventListener("click", () => close());
  const layout = (): void => {
    for (const [it, parent] of home) {
      if (parent === row) row.insertBefore(it, more);
      else parent.appendChild(it);
    }
    close();
    const list = items();
    for (const it of list) if (!home.has(it)) home.set(it, it.parentElement as HTMLElement);
    more.hidden = true;
    const fits = (): boolean => row.scrollWidth <= row.clientWidth + 1;
    if (fits() || !row.clientWidth) return;
    more.hidden = false;
    for (let i = list.length - 1; i >= 0 && !fits(); i--) panel.insertBefore(list[i]!, panel.firstChild);
  };
  return { more, layout, close };
}
