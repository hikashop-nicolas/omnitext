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

Added later the same day: triggered animations (click targets in the show), merging the selected table cells, custom
slide shows, tab stops, swipe navigation in the show, multi-select of slides.

## Status 2026-10-29 (release candidate for 2.0)
Added since: the presenter view in its own window with the show fullscreen on the other screen (Window Management API),
transitions drawn on the GPU (WebGL: the engine hands over the two slide pictures and each frame's triangles, with a CPU
fallback), a click during a transition skips to the next slide, video autoplay kept in the file as a media Play effect that
starts by itself (the engine used to drop it on save), one-row toolbars with a "more" button, a comments entry that opens the
panel, and the CJK faces shipped once as files in wasm/fonts that both engines load at run time (the PDF engine at open, the
deck engine when a deck has Japanese, Korean or Chinese text). The release APK went from 43.3 MB to 37.1 MB.

## Known gaps (not blocking 2.0; pick these up when there is time)
Editing and show
- Rehearse timings and kiosk mode.
- Ruler (tab stops are still added by number) and moving guides by dragging.
- WordArt styles.
- Video as a link or from a web page; recording narration; narration and ink in the show; closed captions.
- Printing handout layouts in the browser (export to PDF works).
- Morph transitions: drawn shape by shape on the CPU path, so they are slower than the others.
Rendering
- Date-axis labels on area charts show the serial numbers instead of dates.
Formats and PowerPoint features we do not have
- Only .pptx opens: .ppsx, .potx, .ppt and .odp do not.
- Designer and Copilot-like suggestions, co-authoring, export to video or GIF.
Size and build
- Video decoders in the deck engine (about 0.6 MB compressed) are only used for poster frames and probing; the browser could do both.
- The PDF and deck engines each carry their own copy of the text, image and PDF-writing code; one shared module would save
  roughly 2 to 3 MB more but the two repos patch different vendored crates, so it is a multi-day job.
- Japanese face (4.7 MB): a kana plus common-kanji subset would roughly halve it.
- Reading the phone's own CJK fonts through a native plugin was considered and dropped (32 MB collection, differs by maker).
Verification still wanted
- The F-Droid dry run with the shared fonts and the size-first build settings.
- Presenter view and GPU transitions have been tried on one real second screen only.
