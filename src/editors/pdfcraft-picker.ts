// Font choice for the PDF editor's text: the standard families and the page's own fonts, then
// every font fontshelf knows (installed, added, Google Fonts behind consent and off in F-Droid
// builds) and a font file. A chosen face is registered with the engine, which embeds the glyphs
// used, so it needs a static TrueType/OpenType file whose embedding permissions allow editing.
import {
  catalogFiles, createFontSelect, getFontFile, hasLocalFontAccess, isFontFileCached, localFontsPermission, pickCatalogFile, remoteAllowed,
  setFontLocale, showFontToast,
  type FontFile, type FontSelect,
} from "fontshelf";
import { getLocale, t } from "../i18n";
import { richdocFonts } from "./richdoc-fonts";
import { singleFace, usableFace } from "./pdfcraft-fonts";

/** What a pick sets on the text. */
export type FontChoice = { family: "helvetica" | "times" | "courier" } | { font: string } | { resource: string };

export interface PickerHost {
  root: HTMLElement;
  /** Registers a font file with the engine; resolves to the name styles use. */
  register(bytes: Uint8Array): Promise<string>;
  confirm(title: string, note: string, ok: string): Promise<boolean>;
}

export interface PickerOptions {
  /** The text's current font: a registered name, a page font name or a standard family. */
  current: string | null;
  /** The page's own fonts (existing text only), by resource. */
  pageFonts: { resource: string; face: string }[];
  bold: boolean;
  italic: boolean;
  /** The standard families offered (default all three). */
  standard?: string[];
  apply(choice: FontChoice): void;
}

const STANDARD: Record<string, "helvetica" | "times" | "courier"> = { Helvetica: "helvetica", Times: "times", Courier: "courier" };
/** Downloads above this size ask first. */
const BIG = 5 * 1024 * 1024;

/** fontshelf's picker (its "In this document" group holds the standard families, the page's fonts and the faces chosen here), with picks turned into engine styles. */
export class PdfFontPicker {
  private readonly remote: false | { provider: "google" };
  /** Registered faces: name styles use -> family shown, and family|weight|italic -> name. */
  private readonly families = new Map<string, string>();
  private readonly byStyle = new Map<string, string>();
  /** Families chosen in this document, shown with its fonts. */
  private readonly used: string[] = [];
  private asked = new Map<string, Promise<boolean>>();
  private live: { picker: FontSelect; opts: PickerOptions; resources: Map<string, string> } | null = null;

  constructor(private readonly h: PickerHost) {
    setFontLocale(getLocale());
    this.remote = richdocFonts().remote;
  }

  /** The registered face last chosen, for new text. */
  lastFont: string | null = null;

  /** Forgets registered faces (another engine document took over). */
  reset(): void {
    this.families.clear();
    this.byStyle.clear();
    this.lastFont = null;
  }

  /** A picker for one text object. */
  create(opts: PickerOptions): HTMLSelectElement {
    this.live?.picker.teardown();
    const resources = new Map<string, string>();
    const picker = createFontSelect({
      docFonts: this.docFonts(opts, resources),
      remote: this.remote,
      container: this.h.root,
      apply: (family) => void this.pick(family, opts, resources),
    });
    picker.select.setAttribute("aria-label", t("pdfcraft.font"));
    picker.select.title = t("pdfcraft.font");
    this.live = { picker, opts, resources };
    picker.set(this.current(opts));
    return picker.select;
  }

  /** Builds the current picker's options again (after its page fonts arrived). */
  refresh(): void {
    const live = this.live;
    if (!live) return;
    live.picker.setDocFonts(this.docFonts(live.opts, live.resources));
    live.picker.refresh();
    live.picker.set(this.current(live.opts));
  }

  dispose(): void {
    this.live?.picker.teardown();
    this.live = null;
  }

  /** What the picker shows for the text's font. */
  private current(opts: PickerOptions): string {
    const cur = opts.current;
    if (!cur) return "";
    const std = Object.entries(STANDARD).find(([, k]) => k === cur);
    return std ? std[0] : (this.families.get(cur) ?? cur);
  }

  private docFonts(opts: PickerOptions, resources: Map<string, string>): string[] {
    resources.clear();
    const out = Object.keys(STANDARD).filter((s) => !opts.standard || opts.standard.includes(s));
    for (const f of opts.pageFonts) {
      const name = f.face.replace(/^[A-Z]{6}\+/, "");
      if (!name || resources.has(name)) continue;
      resources.set(name, f.resource);
      out.push(name);
    }
    const cur = this.current(opts);
    for (const n of [cur, ...this.used]) if (n && !out.includes(n)) out.push(n);
    return out;
  }

  private async pick(family: string, opts: PickerOptions, resources: Map<string, string>): Promise<void> {
    const std = STANDARD[family];
    if (std) return opts.apply({ family: std });
    const resource = resources.get(family);
    if (resource) return opts.apply({ resource });
    if (family === this.current(opts)) return;
    const name = await this.face(family, opts.bold ? 700 : 400, opts.italic);
    if (name) {
      this.lastFont = name;
      opts.apply({ font: name });
    } else this.live?.picker.set(this.current(opts));
  }

  /** Registers `family` (the face nearest the weight and style); null after telling why not. */
  private async face(family: string, weight: number, italic: boolean): Promise<string | null> {
    const key = `${family}|${weight}|${italic ? 1 : 0}`;
    const known = this.byStyle.get(key);
    if (known) return known;
    const base = { weight, italic };
    const cat = catalogFiles(family);
    let file: FontFile | null = await getFontFile(family, { ...base, remote: false, gesture: !cat }).catch(() => null);
    let bytes = file ? singleFace(file) : null;
    // A variable or collection-only installed font: the catalog's static file stands in.
    if ((!file || !bytes || !usableFace(file, bytes)) && cat && remoteAllowed()) {
      const pick = pickCatalogFile(cat.files, weight, italic);
      if (pick && (pick.bytes <= BIG || (await isFontFileCached(pick.url)) || (await this.allowBig(cat.family, pick.bytes)))) {
        const remote = await getFontFile(family, { ...base, local: false }).catch(() => null);
        if (remote) {
          file = remote;
          bytes = singleFace(remote);
        }
      }
    }
    if (!file) {
      // an installed font whose file the browser keeps to itself
      const blocked = !cat && (!hasLocalFontAccess() || (await localFontsPermission()) === "denied");
      showFontToast(this.h.root, t(blocked ? "pdfcraft.fontNoAccess" : "pdfcraft.fontUnavailable", { name: family }), 4000);
      return null;
    }
    if (!bytes || file.embeddable !== true || !usableFace(file, bytes)) {
      showFontToast(this.h.root, t("pdfcraft.fontRefused", { name: family }), 3500);
      return null;
    }
    return this.registered(family, key, bytes);
  }

  private async registered(family: string, key: string, bytes: Uint8Array): Promise<string | null> {
    try {
      const name = await this.h.register(bytes);
      this.families.set(name, family);
      this.byStyle.set(key, name);
      if (!this.used.includes(family)) this.used.push(family);
      return name;
    } catch (e) {
      showFontToast(this.h.root, e instanceof Error && e.message ? e.message : t("pdfcraft.fontRefused", { name: family }), 4000);
      return null;
    }
  }

  private allowBig(family: string, bytes: number): Promise<boolean> {
    let run = this.asked.get(family);
    if (!run) {
      const size = (bytes / 1048576).toLocaleString(getLocale(), { maximumFractionDigits: 1 });
      run = this.h.confirm(t("pdfcraft.fontBigTitle"), t("pdfcraft.fontBigNote", { name: family, size }), t("pdfcraft.fontDownload"));
      this.asked.set(family, run);
    }
    return run;
  }
}
