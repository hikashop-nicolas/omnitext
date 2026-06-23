# docxedit fidelity upgrade

Goal: move the in-browser .docx editor (the docxedit library, embedded by Omnitext)
from "text + basic formatting" toward Word-like display fidelity, while keeping the
in-place save model that preserves every untouched part of the archive byte-for-byte.

## Save model (unchanged principle)

We rewrite only word/document.xml and rebuild the body from the edited HTML. Anything
we cannot fully model as editable HTML is carried through as "passthrough": the
original OOXML for that element is stored, HTML-escaped, in a data-docx-xml attribute
on a read-only placeholder, and re-emitted verbatim on save. This guarantees images,
tables, comment markers, etc. round-trip exactly as long as they are not edited.

## Stage 1 (this pass) -- display + toolbar

- Images: w:drawing (DrawingML a:blip) and w:pict (VML) -> <img> from a data URL built
  from word/media via the relationship id; sized from wp:extent (EMU). Passthrough.
- Tables: w:tbl -> read-only HTML <table> with cell text and borders (w:tblBorders).
  gridSpan -> colspan; merges ignored for display. Passthrough preserves real structure.
- Borders: paragraph w:pBdr -> CSS border on the block; table borders via the above.
- Headers / footers: resolve headerReference/footerReference in sectPr -> header*.xml /
  footer*.xml, rendered as read-only bands at the top and bottom of the sheet. Read-only,
  preserved (we never touch those files).
- Toolbar: text colour (w:color), highlight colour (named w:highlight), font family
  (w:rFonts), font size (w:sz). All already round-trip through the run serializer.

## Stage 2 -- comments (DONE)

- Display: comments.xml is read; commented ranges render with a highlight and a clickable
  speech-bubble marker that opens a popover (author, date, text) and a tooltip. Cross-
  paragraph ranges are reopened per paragraph for valid HTML.
- Preserve: commentRangeStart/End and the commentReference run round-trip as passthrough,
  so existing comments survive an edit-and-save.
- Add comment: toolbar button wraps the selection in fresh markers and appends a w:comment
  to comments.xml on save (creating the part + content-type + relationship when absent).
- Also shipped beyond the original Stage 1: editable headers/footers (written back to their
  parts), a free background-colour picker (w:shd for arbitrary colours, w:highlight for the
  named ones), and an insert-image button (embeds a new media part on save).

## Stage 3 -- pagination (DONE: pageless + markers)

Chosen option A (pageless + markers). Shipped: one continuous A4-width sheet with
header/footer bands; manual breaks (w:br type=page) and w:pageBreakBefore render as a
labelled dashed separator and round-trip; w:lastRenderedPageBreak renders as a subtle
dotted line (display-only, Word recreates it); a toolbar button inserts a manual break.

Not built (option B): full reflow pagination -- measure + split into fixed-height page
boxes, repeat header/footer per page, re-flow on edit. Big effort, fragile in
contenteditable; only build if an accurate on-screen page count is truly needed.

## Honest limitations

- Tables and images are read-only (preserved exactly, not yet editable in place).
- Table merges (vMerge) are not drawn (content still shows; structure preserved on save).
- Headers/footers are display-only.
- No true page reflow (see Stage 3).
