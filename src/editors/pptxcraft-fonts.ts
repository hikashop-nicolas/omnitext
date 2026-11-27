import {
  BASE_FONTS, type FontFile, addDocumentFonts, buildFontGroups, canDraw, catalogFiles, getFontFile, getFontState, isAdded, isFontFileCached,
  onFontsChange, pickCatalogFile, remoteAllowed, requestFontFile, requestRemoteFont, restoreFonts, setFontLocale, setRemoteEnabled,
  showFontToast, showInstalledFonts, fontT,
} from "fontshelf";
import { getLocale, t } from "../i18n";
import { richdocFonts } from "./richdoc-fonts";

// Font choice for the slide engine: a picker fed by fontshelf, and the font files the wasm engine needs to draw a family.
// The engine only has what it was given (Inter, Ubuntu, the script faces), so a family is usable once its file was added.
// Saving needs nothing: a .pptx names its fonts. Embedding takes the files the user has (see embedFiles).

/** Faces the engine carries itself. */
const BUILT_IN = ["Inter", "Ubuntu"];
/** Open twins the engine draws Office fonts with (see DeckCraft's substitutes). */
const TWINS: Record<string, string> = { calibri: "Carlito", "calibri light": "Carlito", cambria: "Caladea" };
/** Downloads above this size ask first. */
const BIG = 5 * 1024 * 1024;
const ACTION = "\u0001";
const SHOW_MINE = `${ACTION}local`;
const GET_MORE = `${ACTION}remote`;
const LOAD_FILE = `${ACTION}file`;

export interface FontsHost {
  root: HTMLElement;
  /** Adds a font file to the engine (false: the engine refused it). */
  addFont(bytes: Uint8Array): Promise<boolean>;
  /** The families the slides use (theme fonts resolved). */
  used(): Promise<string[]>;
  /** Redraws the slide and the strip after new faces. */
  redraw(): void;
  confirm(title: string, note: string, ok: string): Promise<boolean>;
}

export interface Style {
  weight: number;
  italic: boolean;
}

const REGULAR: Style = { weight: 400, italic: false };
const BOLD: Style = { weight: 700, italic: false };

export type FaceKey = "regular" | "bold" | "italic" | "boldItalic";
const FACES: [FaceKey, Style][] = [["regular", REGULAR], ["bold", BOLD], ["italic", { weight: 400, italic: true }], ["boldItalic", { weight: 700, italic: true }]];

/** A family's files for embedding, by face; `restricted` when a face's license forbids it. */
export interface EmbedFiles {
  faces: Partial<Record<FaceKey, Uint8Array | { bytes: Uint8Array; index: number }>>;
  restricted: boolean;
}

export class SlideFonts {
  readonly select = document.createElement("select");
  private remote: boolean;
  private docFonts: string[] = [];
  private unregister: () => void = () => undefined;
  private off: () => void;
  /** Families (lower case) the engine can draw: built in, present at open, or added. */
  private have = new Set(BUILT_IN.map((f) => f.toLowerCase()));
  /** Faces already asked for, by family|weight|italic. */
  private tried = new Map<string, Promise<boolean>>();
  /** Font files added, so a nearest-weight answer is not sent twice. */
  private sent = new Set<string>();
  /** Big downloads: the answer per family. */
  private asked = new Map<string, Promise<boolean>>();
  private prev = "";
  private navKey = false;
  private apply: (family: string) => void = () => undefined;
  private disposed = false;

  constructor(private readonly h: FontsHost) {
    setFontLocale(getLocale());
    this.remote = !!richdocFonts().remote;
    if (this.remote) setRemoteEnabled(true);
    this.select.setAttribute("aria-label", t("pptxcraft.font"));
    this.select.title = t("pptxcraft.font");
    const remember = (): void => {
      if (!this.select.value.startsWith(ACTION)) this.prev = this.select.value;
    };
    this.select.addEventListener("pointerdown", remember);
    this.select.addEventListener("focus", remember);
    this.select.addEventListener("keydown", (e) => {
      remember();
      this.navKey = /^(Arrow|Page|Home|End)/.test(e.key);
    });
    this.select.addEventListener("change", () => this.changed());
    let allowed = remoteAllowed();
    let loaded = getFontState().loaded.length;
    this.off = onFontsChange(() => {
      if (this.disposed) return;
      this.render();
      // Consent just given, or font files back from storage: the slides' missing fonts can come now.
      const files = getFontState().loaded.length;
      if ((!allowed && remoteAllowed()) || files > loaded) void this.loadUsed(this.docFonts);
      allowed = remoteAllowed();
      loaded = files;
    });
    restoreFonts({ local: true, remote: this.remote });
    this.render();
  }

  /** After open: what the engine lacks among the slides' fonts (its own missing list) and the families in use. */
  async opened(missing: readonly string[]): Promise<void> {
    const used = await this.h.used().catch(() => [] as string[]);
    const gone = new Set(missing.map((f) => f.toLowerCase()));
    for (const f of used) if (!gone.has(f.toLowerCase())) this.have.add(f.toLowerCase());
    this.setDocFonts(used);
    await this.loadUsed(used);
  }

  /** The slides changed: picks up new families and loads them. */
  async edited(): Promise<void> {
    const used = await this.h.used().catch(() => null);
    if (!used || this.disposed) return;
    this.setDocFonts(used);
    await this.loadUsed(used);
  }

  /** The family at the caret, shown in the picker; its bold or italic face is loaded when the text uses it. */
  sync(family: string | undefined, bold?: boolean, italic?: boolean, onPick?: (family: string) => void): HTMLSelectElement {
    if (onPick) this.apply = onPick;
    const v = family ?? "";
    if (v && ![...this.select.options].some((o) => o.value === v)) this.render(v);
    this.select.value = v;
    this.prev = this.select.value;
    if (v && (bold || italic)) void this.ensure(v, [{ weight: bold ? 700 : 400, italic: !!italic }]);
    return this.select;
  }

  /** Loads the faces of `family` the engine lacks; true when the engine can draw it. */
  async ensure(family: string, styles: Style[] = [REGULAR, BOLD], gesture = false): Promise<boolean> {
    if (BUILT_IN.some((b) => b.toLowerCase() === family.toLowerCase())) return true;
    let ok = false;
    for (const s of styles) ok = (await this.face(family, s, gesture)) || ok;
    if (!ok) {
      const twin = TWINS[family.toLowerCase()];
      if (twin) for (const s of styles) ok = (await this.face(twin, s, false)) || ok;
    }
    if (ok && !this.have.has(family.toLowerCase())) {
      this.have.add(family.toLowerCase());
      this.render();
    }
    return ok || this.have.has(family.toLowerCase());
  }

  /** The files of `family` the user has: loaded from a file, installed, or already downloaded (never a new download). */
  async embedFiles(family: string): Promise<EmbedFiles> {
    const out: EmbedFiles = { faces: {}, restricted: false };
    const seen = new Set<string>();
    const cat = catalogFiles(family);
    for (const [key, style] of FACES) {
      let file: FontFile | null = await getFontFile(family, { ...style, remote: false, gesture: true }).catch(() => null);
      const pick = !file && cat ? pickCatalogFile(cat.files, style.weight, style.italic) : null;
      if (pick && remoteAllowed() && (await isFontFileCached(pick.url))) file = await getFontFile(family, { ...style, loaded: false, local: false }).catch(() => null);
      if (!file || !sameFace(file, style, key)) continue;
      if (file.embeddable === "restricted") {
        out.restricted = true;
        continue;
      }
      if (file.embeddable !== true) continue;
      const id = `${file.postscriptName ?? file.fullName ?? ""}|${file.index}|${file.bytes.byteLength}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.faces[key] = file.format === "ttc" ? { bytes: file.bytes, index: file.index } : file.bytes;
    }
    return out;
  }

  /** Families embedded in the deck draw from its own files: they count as present. */
  markDrawable(families: readonly string[]): void {
    let changed = false;
    for (const f of families) {
      if (this.have.has(f.toLowerCase())) continue;
      this.have.add(f.toLowerCase());
      changed = true;
    }
    if (changed) this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.off();
    this.unregister();
  }

  // ------------------------------------------------------------------ internals

  private setDocFonts(names: string[]): void {
    const same = names.length === this.docFonts.length && names.every((n, i) => n === this.docFonts[i]);
    if (same) return;
    this.docFonts = names;
    this.unregister();
    this.unregister = addDocumentFonts(names);
    this.render();
  }

  private async loadUsed(used: string[]): Promise<void> {
    for (const f of used) {
      if (this.disposed) return;
      if (this.have.has(f.toLowerCase())) continue;
      if (await this.ensure(f)) this.h.redraw();
    }
  }

  private face(family: string, style: Style, gesture: boolean): Promise<boolean> {
    const key = `${family.toLowerCase()}|${style.weight}|${style.italic ? 1 : 0}`;
    let run = this.tried.get(key);
    if (!run) {
      run = this.load(family, style, gesture);
      this.tried.set(key, run);
      // A failure may succeed later (permission granted, consent given, back online).
      void run.then((ok) => {
        if (!ok) this.tried.delete(key);
      });
    }
    return run;
  }

  private async load(family: string, style: Style, gesture: boolean): Promise<boolean> {
    const base = { weight: style.weight, italic: style.italic };
    const cat = catalogFiles(family);
    // A catalog family never prompts for the local-fonts permission: the download serves it.
    let file = await getFontFile(family, { ...base, remote: false, gesture: gesture && !cat }).catch(() => null);
    if (!file) {
      const pick = cat && pickCatalogFile(cat.files, style.weight, style.italic);
      if (!pick) return false;
      if (remoteAllowed() && pick.bytes > BIG && !(await isFontFileCached(pick.url)) && !(await this.allowBig(cat.family, pick.bytes))) return false;
      file = await getFontFile(family, { ...base, local: false }).catch(() => null);
    }
    if (!file || this.disposed) return false;
    const id = `${file.postscriptName ?? file.fullName ?? file.family}|${file.bytes.byteLength}`;
    if (this.sent.has(id)) return true;
    this.sent.add(id);
    return this.h.addFont(file.bytes);
  }

  private allowBig(family: string, bytes: number): Promise<boolean> {
    let run = this.asked.get(family);
    if (!run) {
      const size = (bytes / 1048576).toLocaleString(getLocale(), { maximumFractionDigits: 1 });
      run = this.h.confirm(t("pptxcraft.fontBigTitle"), t("pptxcraft.fontBigNote", { name: family, size }), t("pptxcraft.fontDownload"));
      this.asked.set(family, run);
    }
    return run;
  }

  private drawable = (name: string): boolean => this.have.has(name.toLowerCase());

  private render(extra?: string): void {
    const st = getFontState();
    const keep = extra ?? this.select.value;
    const groups = buildFontGroups({
      docFonts: this.docFonts,
      base: [...BUILT_IN, ...BASE_FONTS],
      extra: [...st.installed, ...st.added],
      canDraw: (n) => this.drawable(n) || isAdded(n) || canDraw(n),
    });
    const opt = (text: string, value: string): HTMLOptionElement => {
      const o = document.createElement("option");
      o.textContent = text;
      o.value = value;
      return o;
    };
    const parts: (HTMLOptionElement | HTMLOptGroupElement)[] = [];
    const head = opt(t("pptxcraft.font"), "");
    head.disabled = true;
    parts.push(head);
    const group = (label: string, list: HTMLOptionElement[]): void => {
      if (!list.length) return;
      const g = document.createElement("optgroup");
      g.label = label;
      g.append(...list);
      parts.push(g);
    };
    const doc = groups.doc.map((d) => opt(this.drawable(d.name) ? d.name : fontT("fontMissing", { name: d.name }), d.name));
    const known = new Set([...groups.doc.map((d) => d.name), ...groups.fonts].map((n) => n.toLowerCase()));
    if (extra && !known.has(extra.toLowerCase())) doc.push(opt(this.drawable(extra) ? extra : fontT("fontMissing", { name: extra }), extra));
    group(fontT("fontsInDocument"), doc);
    group(fontT("fontsAll"), groups.fonts.map((f) => opt(f, f)));
    const actions: HTMLOptionElement[] = [];
    if (!st.installedFull) actions.push(opt(fontT("fontsShowMine"), SHOW_MINE));
    actions.push(opt(fontT("fontsLoadFile"), LOAD_FILE));
    if (this.remote) actions.push(opt(fontT("fontsGetMore"), GET_MORE));
    group(fontT("fontsMore"), actions);
    this.select.replaceChildren(...parts);
    this.select.value = [...this.select.options].some((o) => o.value === keep) ? keep : "";
  }

  private changed(): void {
    const v = this.select.value;
    const nav = this.navKey;
    this.navKey = false;
    if (!v) return;
    if (!v.startsWith(ACTION)) {
      this.prev = v;
      void this.pick(v);
      return;
    }
    this.select.value = this.prev;
    if (nav) return;
    if (v === SHOW_MINE) void this.showMine();
    else if (v === GET_MORE) void this.getMore();
    else if (v === LOAD_FILE) void this.loadFile();
  }

  private async pick(family: string): Promise<void> {
    this.apply(family);
    const ok = await this.ensure(family, [REGULAR, BOLD], true);
    if (this.disposed) return;
    if (ok) this.h.redraw();
    else showFontToast(this.h.root, t("pptxcraft.fontUnavailable", { name: family }), 3500);
  }

  private async showMine(): Promise<void> {
    const before = getFontState().installed.length;
    await showInstalledFonts({ gesture: true });
    if (this.disposed) return;
    this.render();
    const n = getFontState().installed.length - before;
    showFontToast(this.h.root, n > 0 ? fontT("fontsFound", { n }) : fontT("fontsNoneFound"));
  }

  private async getMore(): Promise<void> {
    await this.picked(await requestRemoteFont({ container: this.h.root }));
  }

  /** The file input opens within the change event, so the browser allows it. */
  private async loadFile(): Promise<void> {
    await this.picked(await requestFontFile({ container: this.h.root }));
  }

  private async picked(family: string | null): Promise<void> {
    if (!family || this.disposed) return;
    this.render(family);
    this.select.value = family;
    this.prev = family;
    await this.pick(family);
  }
}

/** The file answers the face asked for, not a nearest weight or style standing in for it (a variable font only as regular). */
function sameFace(f: FontFile, s: Style, key: FaceKey): boolean {
  if (f.variable) return key === "regular";
  return f.italic === s.italic && ((f.weight ?? 400) >= 600) === s.weight >= 600;
}
