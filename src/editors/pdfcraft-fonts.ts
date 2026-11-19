// Faces named like a PDF's own fonts, from the device or the Google Fonts catalog (fontshelf).
// The engine embeds a registered face whose name matches a paragraph's font when the font's
// subset lacks a letter being typed, instead of drawing that letter in Helvetica.
import { WEB_FONTS, catalogFiles, getFontFile, hasConsent, parseFontInfo, pickCatalogFile, setRemoteEnabled, styleOf, type FontFile } from "fontshelf";
import type { PdfDocument, PdfFontFace } from "craftbridge/pdf";

declare const __REMOTE_FONTS__: boolean | undefined;

export interface FontQuery {
  /** The font's name without its subset tag: "Arial-BoldMT". The face is registered under it. */
  name: string;
  /** The family part: "Arial". */
  family: string;
  weight: number;
  italic: boolean;
}

const STANDARD = /^(helvetica|times|courier|symbol|zapfdingbats)\b/i;
// the engine's own checks (pdfcraft fonts/src/embedding.rs validate): a face it refuses fails the edit
const MAX_BYTES = 16 << 20;
const NO_EMBED = 0x0002 | 0x0004 | 0x0200;
/** No automatic download of a bigger catalog file (CJK families run to 25 MB). */
const MAX_DOWNLOAD = 4 << 20;
const MAX_FACES = 12;
const SCAN_PAGES = 20;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** What to look for for a PDF font name, or null for a standard font or a name with nothing to match. */
export function fontQuery(base: string): FontQuery | null {
  const name = base.replace(/^[A-Z]{6}\+/, "").trim();
  if (!name || STANDARD.test(name) || !/[a-z]/i.test(name)) return null;
  const cut = name.search(/[-,]/);
  const family = (cut > 0 ? name.slice(0, cut) : name).replace(/(PS)?MT$|PS$/, "");
  const style = cut > 0 ? name.slice(cut + 1) : "";
  const { weight, italic } = styleOf(style.replace(/(PS)?MT$/, ""));
  return { name, family: family || name, weight, italic };
}

/** The catalog family a PDF family name stands for ("OpenSans" is Open Sans), if any. */
export function catalogFamily(family: string): string | null {
  const k = key(family);
  return WEB_FONTS.find((w) => key(w.family) === k)?.family ?? null;
}

/** Whether the engine can embed this file (a static TrueType/OpenType face its fsType lets us embed). */
export function embeddable(f: FontFile): boolean {
  if ((f.format !== "ttf" && f.format !== "otf") || f.variable || f.index !== 0 || f.bytes.byteLength > MAX_BYTES) return false;
  const info = parseFontInfo(f.bytes);
  return !!info && ((info.fsType ?? 0) & NO_EMBED) === 0;
}

/** Remote catalog files only in builds that offer them (not F-Droid) and after the user's consent. */
function remoteOk(): boolean {
  const build = typeof __REMOTE_FONTS__ === "boolean" ? __REMOTE_FONTS__ : true;
  if (!build || !hasConsent()) return false;
  setRemoteEnabled(true);
  return true;
}

async function faceFor(q: FontQuery, remote: boolean): Promise<PdfFontFace | null> {
  const opts = { weight: q.weight, italic: q.italic, instance: true };
  // installed fonts only with the permission already granted (fontshelf never prompts without a gesture)
  let f = await getFontFile(q.name, { ...opts, remote: false });
  if (!f && q.family !== q.name) f = await getFontFile(q.family, { ...opts, remote: false });
  const cat = !f && remote ? catalogFamily(q.family) : null;
  const files = cat ? catalogFiles(cat) : undefined;
  const file = files && pickCatalogFile(files.files, q.weight, q.italic);
  if (cat && file && file.bytes <= MAX_DOWNLOAD) f = await getFontFile(cat, { ...opts, local: false });
  if (!f || !embeddable(f)) return null;
  // no scripts: the engine then picks it by name only, never as a fallback for other text
  return { bytes: f.bytes, family: q.name, style: "Regular", scripts: "" };
}

/** Faces for the fonts the first pages use, each found once. */
export async function documentFaces(doc: PdfDocument): Promise<PdfFontFace[]> {
  const queries = new Map<string, FontQuery>();
  for (let p = 0; p < Math.min(doc.pageCount, SCAN_PAGES) && queries.size < MAX_FACES; p++) {
    for (const b of await doc.textBlocks(p).catch(() => [])) {
      const q = b.font ? fontQuery(b.font) : null;
      if (q && !queries.has(q.name)) queries.set(q.name, q);
    }
  }
  const remote = remoteOk();
  const out: PdfFontFace[] = [];
  for (const q of [...queries.values()].slice(0, MAX_FACES)) {
    const face = await faceFor(q, remote).catch(() => null);
    if (face) out.push(face);
  }
  return out;
}
