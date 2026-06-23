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

## Stage 2 (next) -- comments

- Display: read comments.xml; mark commented ranges; a marker + tooltip (author, text);
  optional comments panel. Preserve commentRangeStart/End + commentReference as passthrough
  so existing comments survive a save.
- Add comment ("annotation" toolbar button): wrap the selection in new markers and append
  to comments.xml (creating it + the content-type + rels when absent).

## Stage 3 (decision needed) -- pagination

True live pagination (content reflowing across fixed-height A4 pages with repeating
headers/footers, re-paginating on every edit) is a large engine (this is why Google Docs
has a "pageless" mode). Two options:

- A. Pageless + markers (recommended): one continuous A4-width sheet (current), with
  header/footer bands and explicit page breaks (w:br type=page / lastRenderedPageBreak)
  drawn as visual separators. Cheap, robust, good enough to see structure.
- B. Full reflow pagination: measure + split into page boxes, repeat header/footer per
  page, re-flow on edit. Big effort, fragile in contenteditable.

Recommendation: ship A; only build B if the merchant truly needs WYSIWYG page count.

## Honest limitations

- Tables and images are read-only (preserved exactly, not yet editable in place).
- Table merges (vMerge) are not drawn (content still shows; structure preserved on save).
- Headers/footers are display-only.
- No true page reflow (see Stage 3).
