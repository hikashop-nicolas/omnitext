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

## Comments panel v3 (this pass)

- Link comments to text via the highlight only: drop the inline speech-bubble icon
  (one per thread was showing one per message); clicking highlighted text activates
  the thread and clicking a card highlights + scrolls to its range (stronger active
  colour). One indicator per thread.
- Reply: a "Reply" button on each thread appends a reply that writes a new w:comment
  + commentsExtended threading (paraIdParent) + a comment reference on save.
- Resolve (check) and delete (cross) on each thread: resolve sets w15:done; delete
  removes the comment + its markers.

## Suggestion mode / track changes (DECISION NEEDED, not built)

Word/Google "suggesting" mode records edits as tracked changes (w:ins / w:del) shown
inline, with accept/reject. That is a large feature (record every edit as a revision,
render insertions/deletions, accept/reject each). Recommend scoping it as its own phase
after the comment work; not started here.

## Honest limitations

- Tables and images are read-only (preserved exactly, not yet editable in place).
- Table merges (vMerge) are not drawn (content still shows; structure preserved on save).
- Headers/footers are display-only.
- No true page reflow (see Stage 3).
