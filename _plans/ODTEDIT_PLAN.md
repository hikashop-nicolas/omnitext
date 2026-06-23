# odtedit upgrade plan

Goal: bring the in-browser .odt editor (the odtedit library, embedded by Omnitext)
from "basic text" toward the fidelity docxedit now has, against the OpenDocument
(ODF) schema. Same principle as docxedit: edit content.xml's body in a contenteditable
surface, rebuild it on save, preserve every other part of the archive.

## Where odtedit is today

- Reads only: text:p, text:h, text:span, text:a (links), text:list/list-item,
  text:line-break, text:tab, text:s. Toolbar: B/I/U, lists, link.
- Saves by **wiping office:text and regenerating** it from that subset. So editing an
  .odt that contains a table, image, comment or tracked change **drops it on save**
  (opening + saving unchanged is byte-safe).
- No images, tables, comments, track changes, headers/footers, colours, fonts, sizes.

## Key ODF differences from OOXML (shape the work)

- **Formatting lives in styles, not inline.** A run is `text:span text:style-name="T1"`,
  and T1 is an automatic style in office:automatic-styles defining fo:font-weight,
  fo:color, fo:font-size, style:text-underline-*, etc. To apply bold on save we must
  mint an automatic style and reference it (docxedit just emits inline w:rPr). Plan: a
  small style synthesiser that dedupes automatic styles per run-format combo.
- **Images**: `draw:frame (svg:width/height) > draw:image xlink:href="Pictures/x.png"`,
  bytes in Pictures/, plus a manifest.xml entry. Inserting needs a manifest update.
- **Tables**: table:table > table:table-row > table:table-cell > text:p; borders via
  cell styles.
- **Comments**: `office:annotation` (dc:creator, dc:date, text:p content) anchored
  inline, `office:annotation-end` for ranges. Reply threading is not a first-class
  OOXML-style link; LibreOffice chains replies, needs a short spike to confirm the
  representation.
- **Tracked changes**: `text:tracked-changes` (in office:text) holds text:changed-region
  > text:insertion / text:deletion / text:format-change with office:change-info
  (creator/date); inline `text:change-start` / `text:change-end` / `text:change` mark
  positions. Accept/reject edits these.
- **Headers/footers**: `style:master-page > style:header / style:footer` in styles.xml.
- **Page break**: fo:break-before="page" on a paragraph (its automatic style).

## Phase 0 -- Preservation (safety first, do before anything else)

Stop edited saves from destroying unsupported content. Mirror docxedit's passthrough:
- In odtToHtml, any block/inline element odtedit doesn't model (table:table,
  draw:frame, office:annotation*, text:tracked-changes, text:soft-page-break, fields,
  etc.) renders as a read-only placeholder carrying its original XML (data-odt-xml,
  namespace-decls injected) instead of being skipped.
- In htmlToOdt, re-emit those placeholders verbatim.
- Keep text:tracked-changes / referenced styles intact even when not rendered.
Outcome: editing the text of any .odt never drops its tables/images/comments/changes.

## Phase 1 -- Display + toolbar fidelity

- Images (draw:frame/draw:image from Pictures/) -> <img> data URL; insert + resize +
  preserve (manifest update on insert).
- Tables (table:table) -> read-only HTML table with borders; preserve.
- Run formatting read: resolve text:style-name -> the automatic/named style's
  fo:font-weight/font-style/color/font-size, style:text-underline, fo:background-color.
- Toolbar parity: text colour, background, font, size, alignment, headings, page break.
  Writing formatting = synthesise automatic styles (the style synthesiser above).
- Paragraph fidelity: fo:margin-left/text-indent (indent), fo:line-height (spacing),
  fo:break-before, paragraph style names.

## Phase 2 -- Comments (office:annotation)

Display annotations (creator/date/text) in the same side panel as docx; add/reply/
resolve/delete; round-trip. Spike reply-threading representation first.

## Phase 3 -- Track changes (text:tracked-changes)

Display insertions/deletions/format-changes; a Suggesting toggle that records edits as
ODF tracked changes; accept/reject per change and all. Mirrors docxedit's UX.

## Phase 4 -- Headers/footers + page setup

Master-page header/footer bands (read-only first, then editable); page size/margins.

## Sequencing

Phase 0 is the only urgent one (data safety). Phases 1-4 are value-driven; do them only
if rich .odt editing is actually needed. The biggest extra cost vs docx is the
style-synthesiser (ODF stores formatting in styles, not inline).

## Shared opportunity

docxedit and odtedit now duplicate a lot (passthrough, comments panel UI, track-change
UI, image resize, toolbar). Consider extracting a shared "rich-doc editor" core (UI +
contenteditable plumbing) that each format adapts with its own read/write, so parity
work isn't done twice. Decide before Phase 1.
