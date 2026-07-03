# Omnitext family audit: shipped items (July 2026)

History of what the 2026-07-02 audit (AUDIT_2026-07.md) found and what has been
fixed since. The audit file itself only keeps open items; everything resolved
moves here, with commits, so the reasoning is not lost.

## Correctness sprint (2026-07-03, APK 190)

- sheetedit: Escape no longer commits the formatted display over a formula or
  value (was: one keypress turned "=B2*2" into the literal 6). Commit 78615c7.
- sheetedit: shared formulas resolve on read and de-share safely on edit; stale
  xl/calcChain.xml dropped and fullCalcOnLoad set when formulas change (was: an
  Excel "repair" trigger and stale cached values). Commit 78615c7. Also moved
  dist to build-on-install so consumers stop getting stale code (90981ea).
- pdfedit: owner-password PDFs save (ignoreEncryption on both pdf-lib loads);
  images insert on the page in view instead of always page 1. Commit c3e9ea6.
- richdoc: a document that fails to parse latches read-only with an error
  banner and getBytes returns the original bytes (was: a blank editable surface
  that could overwrite the real file). Commit 527f301.
- omnitext: UTF-16 files open as text (BOM check before the binary sniff);
  Open/New/drop/Back confirm before discarding unsaved edits; .gz files
  round-trip (re-gzip on save under the original name, top-level and archive
  entries). Commits 90c6f96, b711dff.

## Trust sprint, first batch (2026-07-03)

- CI test workflows in all three libs: typecheck + vitest (+ cypress e2e for
  sheetedit/pdfedit) run on every push/PR.
- richdoc preserve-by-default serialization (commit ce7c855): the reader
  stashes unmodeled rPr/pPr content (data-docx-rpr / data-docx-ppr) and the
  writer merges it back at schema position, so small caps, character spacing,
  eastAsia fonts, underline flavours, keepNext/widowControl, outline levels,
  per-paragraph bidi, exact line spacing and first-line/hanging indents survive
  saves; list items keep their original numId (data-docx-numid), so
  roman/letter/custom numbering formats survive too, and numbering.xml stops
  growing.
- richdoc real-file round-trip corpus test: every demo/samples .docx (and
  later .odt) round-trips in the suite with text-fidelity assertions
  (corpus.test.ts; skips in CI where the gitignored samples are absent).

## Trust sprint, second batch (2026-07-03)

- sheetedit ods preservation (commit 7211451): untouched sheets keep their XML
  verbatim; re-emitted sheets clone original row elements (row visibility and
  default-cell-style survive), re-wrap table:table-header-rows, keep
  covered-cell content, and preserve the tail of content runs repeated beyond
  REPEAT_CAP instead of truncating them.
- pdfedit Unicode fallback font (commit a17cd89): new fallbackFont option
  (lazy bytes provider) used in the horizontal, vertical and glyph-preserving
  substitute paths for characters WinAnsi cannot encode; whatever still cannot
  be drawn is counted and reported via the new onWarning callback (en/fr)
  instead of disappearing silently.
- omnitext wiring: bundles Noto Sans JP Regular (OFL) as a lazy asset fetched
  on the first save that needs it; warnings surface as toasts. Verified end to
  end in the production build: Cyrillic + Japanese typed into a Helvetica PDF
  survive a save/re-open round trip and render. (Dev-server note: pdf.js
  worker rendering is flaky under vite dev; test PDF flows on build/preview,
  matching the earlier JBIG2 finding.)

## Trust sprint, third batch (2026-07-03, APK 196)

- richdoc ODT preserve-by-default (commit 50b6472): automatic styles carrying
  unmodeled content (letter spacing, asian fonts, first-line indents,
  keep-with-next, a paragraph style's default run font, non-solid underline
  flavours) are stashed on read and merged back on save, mirroring the docx
  mechanism; asian/complex weight/style/size variants tracked in step.
- richdoc docx in-cell paragraph formatting (commit a71e4a3): table cells
  render through the block pipeline, so in-cell alignment, spacing, named
  styles, headings and lists (with their original numIds) display and survive
  saves; unknown block elements in cells become preserved pass-blocks.
- omnitext binary crash recovery: autosave and startup recovery cover binary
  documents (exported bytes in IndexedDB, 3s debounce, serialized exports).
  Verified: an edited xlsx survives a reload with its edit intact.
- omnitext Save As / rename: saving an unnamed document prompts for a name
  seeded with the format's extension (no more binary "untitled.txt"); clicking
  the filename renames, with gz-aware handling.

## Error/usability tier (2026-07-03, APK 198)

- Error surfaces everywhere: sheetedit shows a localized banner + safe stub
  editor for corrupt/encrypted/non-workbook files (CFB detection, parsererror
  checks with optional parts degrading, chartsheet guard, fd3eeb6); pdfedit
  shows a render-failure banner + onError and frees pdf.js resources on
  destroy (loading-task destroy, blob URL revocation, 824f68c); omnitext wraps
  instance.mount() with a toast + hex/text fallback and catches the docx/odt
  async construction rejections.
- sheetedit keyboarding + clipboard (fd3eeb6): arrow-key cell navigation,
  Ctrl+Home, Delete clears a multi-cell selection, TSV copy of a selection,
  TSV paste of an Excel block.
- sheetedit formula UX (user request, 7fea0cd): formula bar above the grid
  (active-cell ref, two-way mirror of the edited value), sigma button + fn
  menu (SUM/AVERAGE/MIN/MAX/COUNT) that writes =FN(range) after a selected
  row/column run or enters range-pick mode inserting FN(range) at the caret of
  the pending edit; style controls collapse into an "Aa" dropdown on narrow
  toolbars (richdoc pattern); the 2800-line index.ts split into
  model/xlsx/ods/recalc/workbook/editor/toolbar/formulabar modules.

## Resolved per-repo findings (originally listed in the audit)

- omnitext: UTF-16-to-hex-viewer routing; missing dirty guard on
  New/Open/drop/Back; .gz saved uncompressed; untitled.txt for new binary
  documents; no binary crash recovery; unwrapped instance.mount().
- richdoc: whole-body reserialization stripping unmodeled rPr/pPr (docx and
  ODT); list numbering re-pointed at generic definitions on save (docx);
  in-cell paragraph formatting dropped by rebuildTable; blank-editor
  save-overwrite trap after a failed parse; real-file corpus missing.
- pdfedit: silent character loss outside WinAnsi; owner-password PDFs failing
  at save; image insertion hardcoded to page 1; render failures invisible;
  pdf.js loading task never destroyed; image blob URLs leaked.
- sheetedit: Escape destroying formulas; shared-formula corruption + stale
  calcChain; ods regenerating every sheet's body (row attributes, header
  groups, covered-cell content, beyond-cap runs); raw errors on
  corrupt/encrypted files; chartsheet style crash; no arrow-key navigation; no
  multi-cell copy/paste; no formula bar; monolithic single-file layout.
