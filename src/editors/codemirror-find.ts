import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { t } from "../i18n";

// The text editor's find and replace bar, drawn with the app's own controls and colours in
// place of CodeMirror's form-like panel. CodeMirror still does the searching.

/** Counting stops here, so a huge file stays responsive; the count then reads "1000+". */
const COUNT_LIMIT = 1000;

const ICONS = {
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  replace: '<path d="M14 4c0-1.1.9-2 2-2"/><path d="M20 2c1.1 0 2 .9 2 2"/><path d="M22 8c0 1.1-.9 2-2 2"/><path d="M16 10c-1.1 0-2-.9-2-2"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5c0-1.7 1.3-3 3-3h1"/><rect width="8" height="8" x="2" y="14" rx="2"/>',
  replaceAll: '<path d="M14 14a2 2 0 0 1 2-2"/><path d="M14 4a2 2 0 0 1 2-2"/><path d="M16 22a2 2 0 0 1-2-2"/><path d="M20 12a2 2 0 0 1 2 2"/><path d="M20 2a2 2 0 0 1 2 2"/><path d="M22 20a2 2 0 0 1-2 2"/><path d="M14 8a2 2 0 0 0 2 2"/><path d="M20 10a2 2 0 0 0 2-2"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a3 3 0 0 1 3-3h1"/><rect x="2" y="14" width="8" height="8" rx="2"/>',
};

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = false;
  private query: SearchQuery;
  private readonly find: HTMLInputElement;
  private readonly replace: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly replaceRow: HTMLElement;
  private readonly expand: HTMLButtonElement;
  private readonly toggles: { el: HTMLButtonElement; key: "caseSensitive" | "regexp" | "wholeWord" }[] = [];

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom = el("div", "ot-find");
    this.dom.addEventListener("keydown", this.onKey);

    const findRow = el("div", "ot-find-row");
    this.expand = this.button(ICONS.chevron, t("code.showReplace"), () => this.showReplace(this.replaceRow.hidden !== false));
    this.expand.classList.add("ot-find-expand");
    this.expand.setAttribute("aria-expanded", "false");
    const field = el("div", "ot-find-field");
    this.find = this.input(t("code.cm.find"), this.query.search);
    this.find.setAttribute("main-field", "true"); // CodeMirror focuses this one when the panel opens
    field.append(this.find, this.toggle("Aa", t("code.cm.matchCase"), "caseSensitive"), this.toggle(".*", t("code.cm.regexp"), "regexp"), this.toggle("W", t("code.cm.byWord"), "wholeWord"));
    this.count = el("span", "ot-find-count");
    this.count.setAttribute("aria-live", "polite");
    findRow.append(
      this.expand,
      field,
      this.count,
      this.button(ICONS.up, t("code.cm.previous"), () => findPrevious(view)),
      this.button(ICONS.down, t("code.cm.next"), () => findNext(view)),
      this.button(ICONS.close, t("code.cm.close"), () => closeSearchPanel(view)),
    );

    this.replaceRow = el("div", "ot-find-row ot-find-replace");
    this.replace = this.input(t("code.cm.replace"), this.query.replace);
    const replaceField = el("div", "ot-find-field");
    replaceField.append(this.replace);
    this.replaceRow.append(
      replaceField,
      this.button(ICONS.replace, t("code.cm.replaceOne"), () => replaceNext(view)),
      this.button(ICONS.replaceAll, t("code.cm.replaceAll"), () => replaceAll(view)),
    );
    this.showReplace(!!this.query.replace);

    this.dom.append(findRow, this.replaceRow);
    this.refresh();
  }

  mount(): void {
    this.find.select();
  }

  update(u: ViewUpdate): void {
    const q = getSearchQuery(u.state);
    if (!q.eq(this.query)) {
      this.query = q;
      if (this.find.value !== q.search) this.find.value = q.search;
      if (this.replace.value !== q.replace) this.replace.value = q.replace;
      this.refresh();
    } else if (u.docChanged || u.selectionSet) {
      this.showCount();
    }
  }

  private input(label: string, value: string): HTMLInputElement {
    const i = el("input", "ot-find-input");
    i.type = "text";
    i.value = value;
    i.placeholder = label;
    i.setAttribute("aria-label", label);
    i.spellcheck = false;
    i.autocomplete = "off";
    i.addEventListener("input", this.commit);
    return i;
  }

  private button(icon: string, label: string, run: () => void): HTMLButtonElement {
    const b = el("button", "ot-find-btn");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = svg(icon);
    b.addEventListener("click", run);
    return b;
  }

  private toggle(text: string, label: string, key: "caseSensitive" | "regexp" | "wholeWord"): HTMLButtonElement {
    const b = el("button", "ot-find-toggle");
    b.type = "button";
    b.textContent = text;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => {
      b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      this.commit();
    });
    this.toggles.push({ el: b, key });
    return b;
  }

  private showReplace(on: boolean): void {
    this.replaceRow.hidden = !on;
    this.expand.setAttribute("aria-expanded", String(on));
    this.expand.classList.toggle("is-open", on);
    if (on && this.dom.isConnected) this.replace.focus();
  }

  private readonly commit = (): void => {
    const on = (k: string): boolean => this.toggles.find((x) => x.key === k)?.el.getAttribute("aria-pressed") === "true";
    const q = new SearchQuery({
      search: this.find.value,
      replace: this.replace.value,
      caseSensitive: on("caseSensitive"),
      regexp: on("regexp"),
      wholeWord: on("wholeWord"),
    });
    if (!q.eq(this.query)) {
      this.query = q;
      this.view.dispatch({ effects: setSearchQuery.of(q) });
      this.refresh();
    }
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(this.view);
      this.view.focus();
    } else if (e.key === "Enter" && e.target === this.find) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === "Enter" && e.target === this.replace) {
      e.preventDefault();
      (e.ctrlKey || e.metaKey ? replaceAll : replaceNext)(this.view);
    }
  };

  private refresh(): void {
    for (const { el: b, key } of this.toggles) b.setAttribute("aria-pressed", String(this.query[key]));
    this.find.classList.toggle("is-invalid", !!this.query.search && !this.query.valid);
    this.showCount();
  }

  /** "3 of 12": the match the selection is on, out of all of them. */
  private showCount(): void {
    const q = this.query;
    if (!q.search || !q.valid) {
      this.count.textContent = "";
      return;
    }
    const sel = this.view.state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = q.getCursor(this.view.state);
    for (let m = cursor.next(); !m.done && total < COUNT_LIMIT; m = cursor.next()) {
      total++;
      if (m.value.from === sel.from && m.value.to === sel.to) current = total;
    }
    const capped = total >= COUNT_LIMIT ? `${COUNT_LIMIT}+` : String(total);
    this.count.textContent = !total ? t("code.noMatch") : current ? t("code.matchOf", { n: current, total: capped }) : capped;
    this.count.classList.toggle("is-none", !total);
  }
}

/** Search with the app's find bar, at the bottom of the editor. */
export const findBar = (): Extension => search({ createPanel: (view) => new FindPanel(view) });
