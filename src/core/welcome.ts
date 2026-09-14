// The start screen shown in place of an untouched blank document.

export interface BlankStart {
  filename: string | null;
  text: string;
  binary: boolean;
  formatId: string | null;
  recovered: boolean;
}

/** Only a fresh, empty, unnamed plain document gets the welcome; anything the user asked for does not. */
export function welcomeWanted(s: BlankStart): boolean {
  return !s.filename && !s.text && !s.binary && !s.formatId && !s.recovered;
}

export interface QuickNew {
  /** Format id for createNew, or null for plain text. */
  id: string | null;
  label: string;
  ext: string;
  /** Tile accent, a CSS colour. */
  tint: string;
}

export interface WelcomeActions {
  open(): void;
  newDialog(): void;
  create(id: string | null): void;
  palette(): void;
  dismiss(): void;
}

const svg = (d: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICON = {
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  new: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** Build the welcome panel. `tr` is the app's translate function; `native` hides the drop hint. */
export function renderWelcome(tr: (k: string) => string, quick: QuickNew[], actions: WelcomeActions, opts: { native: boolean; mac: boolean }): HTMLElement {
  const root = el("section", "ot-welcome");
  root.setAttribute("aria-labelledby", "ot-welcome-title");
  const inner = el("div", "ot-welcome-inner");
  root.appendChild(inner);

  const hero = el("div", "ot-welcome-hero");
  const title = el("h1", "ot-welcome-title", tr("welcome.title"));
  title.id = "ot-welcome-title";
  hero.append(title, el("p", "ot-welcome-lead", tr("welcome.lead")));
  inner.appendChild(hero);

  const mod = opts.mac ? "⌘" : "Ctrl";
  const big = (icon: string, label: string, hint: string, primary: boolean, run: () => void, shortcut?: string): HTMLButtonElement => {
    const b = el("button", `ot-welcome-action${primary ? " primary" : ""}`);
    b.type = "button";
    b.innerHTML = `<span class="ot-welcome-action-icon">${icon}</span>`;
    const txt = el("span", "ot-welcome-action-text");
    const hintEl = el("span", "ot-welcome-action-hint");
    // The shortcut is its own span so a touch screen, which has no keyboard, can drop it.
    if (shortcut) hintEl.append(el("span", "ot-welcome-shortcut", `${shortcut} · `));
    hintEl.append(hint);
    txt.append(el("span", "ot-welcome-action-label", label), hintEl);
    b.appendChild(txt);
    b.addEventListener("click", run);
    return b;
  };
  const actionsRow = el("div", "ot-welcome-actions");
  actionsRow.append(
    opts.native
      ? big(ICON.open, tr("welcome.openFile"), tr("welcome.openHintNative"), true, actions.open)
      : big(ICON.open, tr("welcome.openFile"), tr("welcome.orDrop"), true, actions.open, `${mod}+O`),
    big(ICON.new, tr("welcome.newDoc"), tr("welcome.newHint"), false, actions.newDialog),
  );
  inner.appendChild(actionsRow);

  const quickHead = el("h2", "ot-welcome-subhead", tr("welcome.startWith"));
  const grid = el("div", "ot-welcome-quick");
  for (const q of quick) {
    const b = el("button", "ot-welcome-tile");
    b.type = "button";
    b.style.setProperty("--tint", q.tint);
    const badge = el("span", "ot-welcome-tile-badge", q.ext);
    b.append(badge, el("span", "ot-welcome-tile-label", q.label));
    b.addEventListener("click", () => actions.create(q.id));
    grid.appendChild(b);
  }
  inner.append(quickHead, grid);

  const foot = el("div", "ot-welcome-foot");
  const privacy = el("span", "ot-welcome-note");
  privacy.innerHTML = ICON.lock;
  privacy.appendChild(el("span", undefined, tr("welcome.private")));
  const links = el("span", "ot-welcome-links");
  const link = (label: string, run: () => void): HTMLButtonElement => {
    const b = el("button", "ot-welcome-link", label);
    b.type = "button";
    b.addEventListener("click", run);
    return b;
  };
  const kbd = el("kbd", undefined, `${mod}+K`);
  const pal = link(tr("welcome.commands"), actions.palette);
  pal.append(" ", kbd);
  links.append(pal, link(tr("welcome.justType"), actions.dismiss));
  foot.append(privacy, links);
  inner.appendChild(foot);
  return root;
}
