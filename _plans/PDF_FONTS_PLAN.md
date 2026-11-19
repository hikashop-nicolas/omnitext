# PDF fonts plan

Font support for the PDF editor (src/editors/pdfcraft*.ts) on PdfCraft's engine through craftbridge,
with fontshelf as the font source. Engine references are to the carry pinned in craftbridge's
pdfcraft.rev (50a1befd67).

## What the engine does today

- `add_font(bytes, family, style, scripts)` (apps/pdfcraft-wasm bindings.rs) calls
  `pdfcraft_fonts::add_craft_font`: a process-wide list of extra faces, read live by every lookup.
  Only craftbridge's worker limits it to "before the first open"; each `openPdf` in Omnitext starts a
  new worker, so a face list applies to one document.
- Scripts decide the fallbacks. Edited or added text the source font cannot show is drawn as Type 3
  outlines from the first face that has every character: Japanese faces (`Jpan`), the bundled Inter
  (Latin, Greek, Cyrillic: only the built-in one, a registered `Latn` face is never used), the first
  `Hans` face, the first `Hang` face (crates/edit/src/text/fallback.rs `type3_faces`). Family names
  only order the Japanese faces (BIZ UDPGothic, Shippori Mincho). A plain Latin letter the source
  subset lacks is written in the standard 14 font of the source's family (`substitute_font`,
  Helvetica/Times/Courier), not embedded.
- Names decide one more step: `embedding::matching_faces(base_font)` returns the registered faces
  whose family (or "family style") equals the paragraph's font name, subset tag dropped, compared
  on lowercase letters and digits. In the styled rewrite path (`FontResolver::encodable_font`,
  crates/edit/src/text_regions/styled.rs) such a face that covers the typed letter is embedded whole
  (Type 0, Identity-H, ToUnicode) and used for that letter. Rendering of non-embedded fonts does not
  use it (only the font inspector's `fallback::substitute` does).
- Embedding: `embedding::validate` refuses a face over 16 MiB, a collection, a variable font, one
  without glyf/CFF outlines, and fsType bits 0x0002 (restricted), 0x0004 (preview and print) and
  0x0200 (bitmap only). A refusal fails the whole edit. The program is embedded complete, never
  subset. Type 3 fallbacks hold only the glyphs drawn.
- User fonts upstream: the desktop app has "Load font..." and "Installed fonts..." for an edited
  paragraph: `register_text_font(page, bytes)` (validate plus `validate_document_input`, which also
  requires an open licence declared in the name table and excludes Source Han/Noto CJK and Adobe
  fonts) adds a page font resource, and `BlockStyle.resource` picks it. None of this is in the wasm
  facade, and added text (`AddedText`, text boxes, typewriter) only knows Helvetica, Times, Courier.

## What Omnitext does now (no engine change)

src/editors/pdfcraft-fonts.ts: when the editor first enters edit mode, it reads the font names of the
first 20 pages' text blocks, asks fontshelf for a face per name (installed font when the local-fonts
permission is already granted; the Google Fonts catalog file when the build offers remote fonts and
the user consented, Google Fonts' static file of the nearest weight, up to 4 MB), keeps the faces the engine would
embed, and reopens the still untouched document with them registered under the PDF's own font name
and no scripts (so they only ever match by name). The first change waits up to 2.5 s for that, then
reopening stops. Not in a sharing session, where every peer must produce the same file. Effect: a
letter typed into a subset font that lacks it is written in the real face instead of Helvetica.

Limits: names must match the file (ArialMT finds the installed Arial by PostScript name; the remote
catalog only by family, so no metric clones like Carlito for Calibri, which would break upstream's
"never silently another family" rule); the whole face is embedded; registered faces skip upstream's
open-licence check (fsType is still enforced by the engine and by us).

## A real font picker: what the engine needs

API shape (wasm facade, mirrored in craftbridge's protocol):

1. `listTextFonts(page)` -> `{ resource, face, fullFace, previewOnly }[]` (wraps `text_editor_fonts`).
2. `registerTextFont(page, bytes)` -> resource name (wraps `register_text_font`): after open, undoable,
   with the engine's own fsType and licence checks.
3. `setText` style gains `resource` (wraps `BlockStyle.resource`) and per-range resources
   (`BlockStyle.ranges`), so a paragraph or a selection can take a chosen face.
4. Added text (`AddedText`, text box, typewriter, header/footer, watermark): a `resource` or face
   bytes beside `family`, laid out with that face's metrics and written as an embedded font.
5. Save: subset embedded faces to the glyphs used (keep whole when fsType bit 0x0100 says so),
   re-subset on later edits; keep refusing 0x0002/0x0004/0x0200 faces.
6. craftbridge only: an `addFonts` op so fallback faces can be added after open without a reopen.

fontshelf mapping: the picker is `createFontSelect` (document fonts from `listTextFonts`, "Show my
fonts", "Get more fonts" behind consent, off in F-Droid); choosing a family calls
`getFontFile(family, { weight, italic, gesture: true })`, checks `embeddable` and
`embedding` ("restricted" and "preview-print" refused, `noSubsetting` passed on), then
`registerTextFont` and `setText({ resource })`.

## Upstream PR stories (storytold/pdfcraft)

1. "Web: let a page load a font for edited text": items 1 to 3 in pdfcraft-wasm, no engine change
   (the desktop already does it). Smallest, first.
2. "Added text in a loaded font": item 4, engine change in crates/edit added text plus the panel,
   so the desktop gets it too.
3. "Subset loaded fonts on save": item 5, a subsetter in crates/fonts embedding.
4. Possibly "Register a user face for name matching through the document-input checks", so the
   matching path Omnitext uses gets the same licence policy as Load font.

Our carry takes each PR branch only while it waits for review.
