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

## CSV-in-sheetedit batch (2026-07-08)

Per _plans/CSV_AND_STRUCTURE_PLAN.md in the sheetedit repo (all three open
decisions approved: sheet default view, formulas computed, convert opens new):

- sheetedit restructured like richdoc: src/core (+ core/ui) and
  src/adapters/{xlsx,ods,csv} with read/write/styles split per format;
  identical public export surface.
- sheetedit csv adapter: sniffed delimiter, span-preserving rows (open-save
  byte-identical, no numeric coercion of untouched data), formulas computed on
  open and saved as text, structure ops wired, csv-mode UI (no styling
  cluster, no tab bar) plus a Convert-to-XLSX button whose output carries
  values, formulas with cached results, and column widths.
- omnitext: csv/tsv now default to the sheet view (Table and Text stay in the
  switcher); the sheet adapter bridges text documents through sheetedit's
  synchronous getText() so encoding, history and .gz keep working; Convert
  opens the produced .xlsx as a new document behind the usual dirty guard.
  Verified live end to end (edit 800->900, total recalcs to 1150, converted
  workbook opens with full styling UI and the computed total).

## Virtualized grid batch (2026-07-08, sheetedit fef6c8a..d2eec45)

- Two-axis windowed rendering: only the viewport rows/columns (plus overscan)
  get DOM, with spacer geometry keeping the scrollbars honest. The ROWS_CAP /
  COLS_CAP render limits are gone; the remaining bounds are the file formats'
  own grid limits. Custom row heights / column widths resolve in O(log n)
  via sorted delta indexes; merges extend the window so they render whole;
  an in-progress edit is pinned (value + caret) across window re-renders;
  keyboard navigation scrolls the target into the window first. Selection
  ops bounded for the uncapped world (paint = rendered cells, clear = existing
  cells, copy clamps to the used extent).
- Found en route and fixed: fast-formula-parser's built-in aggregates are
  quadratic in range size (SUM over a 100k-row column: ~30s, frozen tab).
  recalc now overrides SUM/AVERAGE/MIN/MAX/COUNT/COUNTA with single-pass
  Excel-semantics implementations: 100k-row SUM in ~100ms. Also dropped a
  redundant recalc from the csv getText path (halves commit cost for hosts).
- Verified live on a 100k-row ; 12-col CSV in omnitext: opens in seconds with
  ~550 DOM cells, jump-to-bottom shows the computed total, editing row 50000
  updates the SUM exactly, deep edits save with untouched neighbours intact.
  8 new tests including a perf guard.

## Trust + storage batch (2026-07-08)

- sheetedit formula trust (92252eb): unknown sheet names give #REF! instead
  of silently reading sheet 1; formulas that cannot be evaluated (unknown
  function, parse failure) keep the file's cached value but carry a red
  corner badge with an explanatory tooltip (en/fr/ja); circular references
  are badged on the true cycle members (reverse peel separates cells merely
  downstream). The DATEDIF-class behavior stays silent by design. 6 tests.
- omnitext IndexedDB retention (core/retention.ts): crash-recovery snapshots
  pruned at boot (30 days / newest 20, never the current session); version
  history capped per document (100, automatic snapshots dropped before
  deliberate ones) with whole-document cleanup after 90 idle days; quota
  errors now prune-and-retry, and a persistent failure surfaces one toast
  (notify.storageFull) instead of dying silently. Policies are pure
  functions with 7 tests.

## Product-win batch (2026-07-08)

- pdfedit (2506183, a56ffc2): find bar (Ctrl+F, highlights over lazily
  rendered pages, never mutates the editable overlays); bold/italic toggles
  keep the embedded typeface (sibling variant, else faux bold double-strike /
  faux italic shear on the original font) instead of dropping to Helvetica;
  user-password PDFs open view-only after a prompt; exports no longer embed
  an unused standard font. 5 unit + 4 e2e tests with new embedded-font and
  AES-encrypted fixtures.
- sheetedit (e12eccc): fill handle (series, cyclic patterns,
  trailing-integer text, relative formula copy; drag preview; one undo step)
  and find/replace (finds across sheets, replaces on the active one,
  replace-all in one undo step). 12 tests.
- omnitext: command palette on Cmd/Ctrl+K over the engine command registry
  plus core actions and the current document's views; fuzzy ranking with
  word-start bonuses and diacritic folding (core/palette.ts, 6 tests);
  aria combobox/listbox semantics. The history tool's command title is now
  localized. Everything verified live in French.

## richdoc product batch + dark mode (2026-07-08)

- richdoc (6077a5d): comment text editing (inline textarea on every thread
  item; rewrites travel through CommentEdits.edited into comments.xml with
  the w14:paraId anchor preserved, and into rebuilt odt annotations); the
  new-comment prompt became a dialog; live word/character count; image files
  drop-insert at the caret point; print / save-as-PDF via a same-origin print
  window that clones the page cards and stylesheets. 2 tests; all verified
  live.
- Dark mode: richdoc (5951747) and sheetedit (61a0869) chrome palettes became
  --rdoc-* / --sheetedit-* custom properties (documents stay paper-white);
  omnitext maps them from its own tokens, adds a Settings theme select
  (system/light/dark, persisted, no-FOUC inline boot script) and remounts the
  active editor on theme or OS changes so mount-sampled surfaces follow.
  Verified live both ways: forcing light turns the whole family light
  including both libraries' chrome, grid cells and pages stay white.

## Print fixes + toolbar placement (2026-07-08, richdoc 28120db + 1d70228)

- Print buttons moved into the top toolbar: print far left, find/replace far
  right (margin-left auto), both outside the overflow-managed item range.
- Extra blank first page then all-white pages fixed: the print window now uses
  a single flowing clone (Chrome's print engine paints clipped abs-positioned
  sheets blank) with @page sized to the measured card pitch (page height plus
  the 24px gap), so every paper page starts on a card boundary. Unpaginated
  docs keep @page margin 15mm.

## sheetedit dates + number formats (2026-07-08, sheetedit d150550)

- New core/dates.ts: Excel 1900-system serial math (fake leap day included),
  ISO / ODF-duration conversions, typed-date recognition, format
  classification. Typed dates, bare times and "50%" now store real serials /
  fractions and adopt a matching number format; the French locale accepts
  comma decimals ("3,5"); CSV mode is exempt (what you type is what the file
  stores). xlsx t="d" cells parse to serials; untouched ones keep their XML.
- Persistence: model-adopted formats are interned into styles.xml on save
  (custom numFmt, xf clone; a minimal styles.xml is minted when absent), and
  ods cells map back to their ODF value type, so editing an ods
  date/time/percentage/currency cell no longer degrades it to a float.
- Toolbar "123" number-format picker (General/number/thousands/percent/
  currency/date/datetime/time), presets localized (EUR/USD/JPY, d/m vs m/d).
  Date cells edit as "2026-07-08", not their serial. Undo carries formats.
- 25 new tests (141 total); verified live in omnitext (b0472ff): fr typed
  "8/7/2026" -> 08/07/2026, "3,5" -> 3.5, "=A1+1" on the date + Date preset
  -> 09/07/2026, "3,5" + Monnaie -> "3.50 €", formula bar shows the ISO date.

## PPTX + EPUB viewers (2026-07-08)

- .pptx: read-only slide viewer on @aiden0z/pptx-renderer (Apache-2.0,
  DOM/SVG, windowed slide list, echarts for charts; the pdfjs SmartArt
  fallback is disabled because it wants pdfjs-dist v5 vs the app's v6, pinned
  via a package.json override). .epub: read-only paginated reader on
  @intity/epub-js (BSD-2-Clause, sandboxed iframe without allow-scripts,
  prev/next arrows + arrow keys; epub.js clobbers its target element's class,
  so it renders into a holder inside the styled page card).
- Both are binary formats routed by extension; the editors implement
  getBytes() so view switches carry the file. Both libs are lazy chunks; i18n
  labels/strings added in en/fr/ja; README updated.
- Follow-up (owner feedback, 2026-07-09): the archive alternate view was
  removed from both (normal users don't need the zip internals), and pptx
  gained a fullscreen presentation mode: a Present button over the list, one
  slide scaled to the screen, arrows/space/click to advance (Home/End too), a
  slide counter, Escape to leave, and the list re-syncs to the ended slide.
- Second follow-up (same day): a left thumbnail sidebar (numbered, click to
  jump, active slide highlighted and kept in view, hidden on narrow screens
  and 1-slide decks), and arrows/space/PageUp-Down/Home/End snap between
  slides in the normal list view too. Verified live: thumb click, arrow and
  space navigation, highlight tracking.
- Verified live on the production build with generated fixtures (3-slide
  python-pptx deck incl. leveled bullets and a styled shape; 2-chapter
  hand-built epub): rendering, page turns, epub <-> archive round-trip.

## sheetedit cell styles completed (2026-07-09, sheetedit 2f2bfc6 + dae566d)

- The six missing style fields ship end to end: font size, font family,
  underline, strikethrough, wrap text and vertical alignment, read+write
  through the xlsx style pools (u/strike/sz/name on fonts, vertical/wrapText
  on the xf alignment) and the ods automatic styles (style:text-underline-/
  line-through-style, fo:font-size/-family, fo:wrap-option,
  style:vertical-align). Font size/name equal to the workbook default are
  suppressed on read so plain cells keep an undefined cellStyle.
- Toolbar: stateless font-family and size pickers (placeholder re-selects
  after apply), U/S buttons (float bar too), valign top/middle/bottom, wrap
  toggle; i18n in en/fr/ja. Grid renders underline/strike/size/family; wrap
  and valign persist but a single-line <input> grid cannot show them (logged
  as residue).
- Fixed along the way: workbooks with no xl/styles.xml (e.g. from the CSV
  converter) silently ignored every style button; setXlsxCellStyle now mints
  the minimal stylesheet like the number-format path (regression test).
- 8 new tests (149 total). Verified live in the sheetedit demo and the
  omnitext production build (dc5e1e8): A1 bold 18pt Georgia underline+strike
  applied and rendered; also fixed stale README credits (richdoc) and the
  binary-viewers SVG comment in the same omnitext commit.

## Media viewer keyboard controls (2026-07-09)

- Audio/video player shortcuts, requested by the owner: space/K play-pause,
  F fullscreen (video only), M mute, left/right seek 5s, up/down volume 5%,
  Home/End jump to start/end. Handled on the focused viewer wrapper (focused
  on mount), preventDefault so space doesn't scroll and native handling never
  double-fires; the hint is the element tooltip + aria-label (separate audio
  string without the F segment).
- The two hardcoded English messages (unsupported format, nothing to play)
  moved to i18n; en/fr/ja strings added.
- Verified live on the production build (wav tone + in-browser recorded
  webm): play/pause, seek, mute, volume all respond. F is exercised to the
  requestFullscreen call (trusted key, correct element) but the automation
  harness denies fullscreen with the debugger attached — even Chrome's own
  fullscreen control button is refused there — so the actual fullscreen entry
  needs one manual keypress on a real screen, like the pptx Present flow did.

## Media container compatibility (2026-07-09)

- Tier 1, routing: .mkv/.mka, .weba, .3gp/.3g2, .mts/.m2ts, .avi, .wmv/.wma
  now route to the media viewer instead of the hex view (.aac also got its
  own audio/aac entry instead of riding audio/mp4). Chrome/WebView plays
  several of these directly (mkv shares the WebM demuxer); the rest get the
  viewer's clear message instead of hex gibberish. .ts stays TypeScript.
- Tier 2, remux fallback: when the media element errors, mediabunny
  (MPL-2.0, ~620 KB lazy chunk loaded only on failure) repackages the file
  in memory — stream copy when the codec fits the target container, WebCodecs
  transcode when the platform can decode it but the copy doesn't fit — trying
  MP4 then WebM for video, MP4/Ogg/WAV for audio, then plays the result. The
  document bytes stay untouched (getBytes still returns the original); the
  "Converting for playback…" note shows meanwhile (i18n en/fr/ja).
- Codecs the platform truly lacks (WMV, MPEG-2 video, old DivX) still fail
  with the clear message: fixing those means ffmpeg.wasm (~30 MB, COOP/COEP,
  GPL care), deliberately not taken; logged as a feature idea.
- Verified live on the production build: a generated H.264 MPEG-TS (.mts)
  failed direct playback, showed the converting note, remuxed to MP4
  (ftypisom bytes confirmed) and played; a .mkv played directly with no
  remux; the wav/webm shortcut tests still pass.

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
