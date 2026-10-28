# PPTX editor: what the engine can do, and what the screen exposes

DeckCraft's engine has about 330 commands (a PowerPoint-sized surface). The editor (pptxcraft) drives about 40 of
them. The gap is user interface, not engine. Plan: a side Inspector panel (toggle in the bottom bar), contextual to
the selection, in the order below; the floating bar keeps the quick formatting.

## Exposed today
Open/save, undo/redo, select, text boxes, 7 shapes, pictures, video, audio (inserted or from the file), tables
(insert only), slides (new with layout, duplicate, delete, move, drag reorder), notes, bold/italic/underline, size
step, colour, align, bullets, fill, outline colour... front/back, duplicate, delete, copy/paste, resize/rotate/move by
handles, zoom, pinch, slideshow, presenter view on a second window.

## Phase 1: Inspector (this stretch)
- Slide: layout, background, hidden, transition (effect, option, duration, on click/after, apply to all), theme colours
  and fonts, slide size, header/footer/slide number.
- Animations: list on the slide, add (effect, class, start, duration, delay), remove, reorder.
- Shape: X/Y/W/H, rotation, flip, line (colour, width, dash, arrows), shadow/glow, change shape, align and distribute,
  group/ungroup, lock, alt text.
- Text: font family, size, bold/italic/underline/strike, super/subscript, highlight, case, spacing; paragraph (align,
  line spacing, space before/after, indents), bullets and numbering, text box (anchor, autofit, wrap, margins,
  columns, direction).

## Phase 2
- Tables: rows/columns insert/delete, merge/split, style, shading, borders, cell alignment, sizes.
- Pictures: crop, corrections, styles, recolor, background removal, change/reset, compress.
- Charts: insert, type, data editing, elements.
- SmartArt: insert, text pane, layout, colours.
- Hyperlinks and actions, WordArt, symbols, icons, date/slide number fields, photo album, zoom.
- Edit points, merge shapes, connectors, freeform and ink.

## Phase 3 (done: playing transitions and animations, PDF/PNG export, master and layout view)
- Playing transitions and animations in the slideshow and presenter view (today the show is static slides).
- Comments (add, reply, resolve), find/replace, spelling and thesaurus, accessibility check, compare/revisions.
- Slide master/layout editing, handout and notes masters, sections, custom shows, set-up show, rehearse.
- Export (PDF, images, video), print layouts, templates, recovery.
- Format painter, guides and grid, ruler.
- Insert video as a link or online source; trimming UI for media.

## Status 2026-10-28 (end of the autonomous stretch)
Done: everything in Phase 1 and 2 except the items below, and in Phase 3: transitions and animations in the show,
PDF/PNG export, master/layout/notes/handout views, sections, comments (reply, resolve), find/replace, spelling,
thesaurus, compare, accessibility check, guides, edit points, slide multi-select, hyperlinks/actions followed in the
show, show setup (loop, range, no animation), photo album, zoom links, icons, outline import, slide reuse.

Not done: triggered animations (a shape starting another's sequence) and their click targets in the show, rehearse
timings and kiosk mode, tab stops and ruler UI, drag-to-select table cells (the engine selects them and the editor
shows the box; merge still asks for row/column numbers), moving guides by dragging, WordArt styles, video as a link
or from a web page, recording narration, custom shows UI (the command exists), printing handout layouts in the
browser (export to PDF works).
