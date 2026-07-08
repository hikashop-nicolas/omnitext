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

## Editing/robustness batch (2026-07-03)

- sheetedit undo/redo (commit 29ede77): every action records the affected
  cells' fields before/after (value edits via grid or formula bar, range
  clears, TSV pastes, styles, borders, merges with structural inverses);
  Ctrl/Cmd+Z / Shift+Z / Y plus toolbar buttons; bounded to 100 steps. Also
  fixed a latent bug the tests exposed: a re-render while a cell input was
  focused could fire a late blur on the stale element and commit its outdated
  value over fresh state; commits are now guarded by input identity.
- sheetedit floating style bar (commit 29ede77): bold/italic/colours/alignment
  appear near the selection when the mouse approaches it (richdoc's float-bar
  pattern), constrained to the grid area, disabled on touch devices.
- omnitext encoding handling (commit 0a16662): strict UTF-8 with a
  windows-1252 fallback ends the silent U+FFFD corruption of Latin-1/cp1252
  files; a status-bar encoding pill shows the decode in use and re-decodes the
  kept original bytes on demand (utf-8, windows-1252, iso-8859-15, shift_jis,
  euc-jp, gbk, big5, windows-1251, koi8-r), guarded by the dirty confirm.
- pdfedit lazy page rendering (commit 21396f8): page shells appear instantly
  and content renders as pages approach the viewport; session-state indexes
  became per-page (stable under lazy order) and restore force-renders the
  pages it needs; overlay-font passes scoped and idempotent.

## Undo/redo + PWA batch (2026-07-07)

- omnitext PWA (commit 9f1fbe7): web app manifest (installable, standalone,
  192/512 + maskable icons) and a build-generated service worker precaching the
  whole dist under a content-digest cache name. Navigations stay network-first
  (never re-cached, so a new index.html can't pair with old chunks); everything
  else is cache-first. Ends the stale lazy-chunk 404s after a redeploy and makes
  the app fully offline (verified: killed the server, app reloads and lazy
  chunks serve from cache). Found and fixed en route: cache.put stores decoded
  bodies with the network headers, and stale Content-Encoding / Vary: Origin
  headers make Chrome reject entries for Vite's crossorigin-attributed
  stylesheet/script tags; responses are stored sanitized.
- pdfedit document-level undo/redo (commit e85d98b): a unified snapshot stack
  covers typing, execCommand toggles, Range-surgery styling, alignment, text
  boxes and images (native undo only ever covered the first two). Typing
  coalesces per paragraph, image nudges per image; pristine overlay HTML is
  captured while clean so undo returns paragraphs to unedited and resets
  isDirty. Ctrl/Cmd+Z/Y + toolbar buttons + undo/redo/canUndo/canRedo API.
  Also fixed: session state now records per-paragraph alignment (was lost on
  getState/applyState round trips), and a blur-reentrancy crash when removing
  a focused empty box (caught by the new e2e).
- richdoc trustworthy undo/redo (commit 2bbc6d9): snapshot stack over the
  logical body (cleanBody output, data-URL images interned into a shared pool),
  restored wholesale with immediate reflow and caret re-placed by logical block
  index through the pagination wrappers. Typing runs capture lazily (400ms
  idle / focusout / discrete op), never mid-IME-composition; suggest-mode
  typing coalesces too. Bands and notes keep native undo (Ctrl+Z only
  intercepted inside the body). Toolbar buttons + RichEditor
  undo/redo/canUndo/canRedo. Verified live on the two-column sample, where
  repagination reparents blocks around every edit.

## CSV sniffing + richdoc paste batch (2026-07-08)

- omnitext CSV delimiter sniffing (commit after 3123d47): csvImpl.parse sniffs
  comma/semicolon/tab/pipe with a quote-aware per-line consistency score and
  keeps the winner on the model, so a semicolon CSV (French Excel default)
  opens as a real grid and dirty rows re-serialize with the file's own
  separator. Content detection for extension-less files uses the same scorer
  and demands structure, ending the "prose with a comma routes to the table
  editor" false positive. Verified live: semicolon CSV opens 3-column.
- richdoc paste pipeline (commit 76550e9): external clipboard HTML is
  normalized onto the editor vocabulary (headings, alignment/indent, lists
  nested inside the li, tables rebuilt as docx-table/docx-cell, semantic tags
  to b/i/u/s, run-style whitelist, safe hrefs, pre to monospace paragraphs,
  Google Docs wrapper unwrapped, transparent backgrounds dropped). External
  images fetch-inline to data URLs (capped 600px); CORS/non-image failures
  degrade to a visible link instead of vanishing on save; clipboard image
  files paste directly. Internal copies and suggest mode keep their existing
  paths. 23 unit tests + an e2e write check; verified live in omnitext
  (GDocs-style paste + same-origin image inlined, junk styles stripped).

## Row/column structure batch (2026-07-08)

- omnitext table view row/column ops (commit c78c66a): the ViewEdit contract
  gained insertRow/deleteRow/insertCol/deleteCol, implemented by csv and tsv
  (span-preserving: untouched rows stay byte-exact, new rows take the file's
  dominant terminator) and xls/xlsx (grid splices). The table editor grew a
  toolbar acting on the focused cell, with en/fr/ja strings. Verified live.
- sheetedit row/column insert/delete with reference rewriting (commit
  34f9352): right-click on a row/column header (single line or whole-line
  selection run). References rewrite across all sheets with sheet-prefix
  resolution: shifts (anchors too), #REF! on deletes, range grow/shrink,
  whole-column and whole-row ranges. Model, merges (+mergeCells XML),
  sizes, xlsx sheet XML (implicit refs materialized first, cols/dimension
  remapped, shared groups de-shared, calcChain dropped) and ods row
  metadata / column declarations all shift together. Structural undo
  restores dropped cells, formulas, merges and sizes from a snapshot;
  earlier history is cleared as its positions no longer replay. Verified
  live in omnitext: SUM range extended on inside-insert with live recalc,
  shrank on delete, undo restored formula and values. Known limit:
  hyperlink/validation/conditional-format anchors are not rewritten.

## Dropped by decision (not fixed, closed on purpose)

- omnitext "HTML default editor is destructive" (Quill as the default .html
  editor rewrites the file via getSemanticHTML on the first keystroke):
  owner decided 2026-07-08 the current behavior is fine; the text editor
  remains available via the view switcher. Not a bug to fix.

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
  multi-cell copy/paste; no formula bar; monolithic single-file layout; no
  undo/redo; no floating style bar.
- omnitext: legacy encodings corrupting silently (no picker); not a PWA (no
  manifest/service worker, stale-chunk 404s after redeploys).
- pdfedit: eager full-document rendering; undo/redo partial to absent.
- richdoc: native undo invalidated by pagination reparenting and programmatic
  mutations.
