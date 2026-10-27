# Craft engines for Omnitext 2.0 (DRAFT, 2026-10-25)

Status: first draft after a day of spikes. Nothing here is decided. Every number marked
"measured" was measured on this machine on 2026-10-25; everything else comes from the upstream
repos' own docs and is marked "claimed".

## What the Craft suite is

ArtCraft (github.com/storytold) publishes a family of clean-room, pure-Rust reimplementations of
desktop apps, nearly all created between 2026-09-30 and 2026-10-09, all MIT OR Apache-2.0, all
developed with heavy AI assistance (AGENTS.md and CLAUDE.md in every repo, effort estimates in
"Opus agent hours"). Relevant to Omnitext: pdfcraft (Acrobat), deckcraft (PowerPoint), wordcraft
(Word), gridcraft (Excel), cadcraft (AutoCAD), vectorcraft (Illustrator), photocraft
(Photoshop), figcraft (Figma), filmcraft, soundcraft. Each is a Cargo workspace of headless
crates (model, engine, render, format readers and writers) plus an egui desktop app and an egui
web build. Every one of them states its own stage and its own readiness estimate:

| App | Stage (own words) | Ready for real work (own estimate) | Open issues | Latest |
|---|---|---|---|---|
| pdfcraft | alpha | about 50% (full Acrobat Pro), 55% mainstream | 2046 | 0.14.0 |
| deckcraft | alpha | about 55% | many | 0.11.1 |
| wordcraft | alpha | about 60% | 1796 | 0.11.0 |
| gridcraft | alpha | about 50% | 1218 | 0.12.1 |
| cadcraft | pre-alpha | about 38% | 904 | 0.13.0 |
| figcraft | alpha | about 53% | 337 | 0.11.2 |
| vectorcraft | alpha | about 62% | 929 | 0.17.0 |
| photocraft | alpha | about 45% | 3144 | 0.16.0 |

Star counts are very high (photocraft 72k, pdfcraft 18k, deckcraft 4k) for repos a month old.
Treat them as a popularity signal only, never as a quality signal.

## What was tested (measured)

Toolchain: rustc 1.99.1 with the wasm32-unknown-unknown target, installed with rustup into the
scratch folder, plus wasm-bindgen 0.2.129 (the version their lockfile pins) and binaryen from npm.

1. **All three headless engines compile to wasm32**: pdfcraft-engine (4 min cold), cadcraft-engine
   (1 min), deckcraft-engine (1.5 min). No egui or windowing crate is involved.
2. **A 90-line wasm-bindgen wrapper around pdfcraft-engine** (open bytes, render a page to RGBA,
   list paragraphs, edit a paragraph, delete or rotate a page, save) compiled first time and ran in
   headless Chrome: wasm init 94 to 262 ms, open 33 to 49 ms, render a page 50 to 85 ms, edit a
   paragraph 19 ms, save 1 ms. The saved file validated in poppler, the extracted text had the
   edit, and the original bytes were preserved as a prefix (incremental save, 4.3 KB appended).
3. **PdfCraft native CLI on six PDFs**: renders in 27 to 57 ms, paragraph grouping correct on a
   French contract (accents intact), paragraph edit, paragraph move, page rotate/delete/move,
   all saved as an incremental update that keeps the original bytes and signatures valid.
4. **Japanese editing works, with a catch**: the engine refuses to draw Japanese without a full
   font ("this build doesn't include" its craft-fonts). A host can load a font at runtime
   (text_font_import, or the RegisterTextFont edit); with BIZ UDPGothic loaded, a Japanese
   paragraph was replaced cleanly. Their asset policy REFUSED our bundled Noto Sans JP because it
   is Adobe-authored, so we cannot reuse that file.
5. **CADCraft native CLI**: opened the 49 KB apartment.dxf sample (dimensions, hatches, table,
   leaders), rendered it to PNG in 0.25 s, correct and good looking; wrote DWG (14.5 KB) and
   read it back with the same entity counts; DXF to DXF through DWG grew 49 KB to 55 KB.
6. **DeckCraft** (earlier spike): three real decks round-trip with content intact and pixel
   identical in LibreOffice, but every package part is rewritten (BetterOffice rewrites one).
7. **Phone**: the real PdfCraft web app, built from source, in Chrome at 390 px with touch
   emulation: the desktop layout squeezed into a phone, title-bar buttons overlapping, panels
   clipped. Their own docs say the web build is "not touch-first" and no roadmap has a phone UI.

### Sizes (measured)

| Artifact | Raw | gzip |
|---|---|---|
| pdfcraft headless wrapper, release | 22.7 MB | 7.2 MB (5.4 MB brotli) |
| same, wasm-opt -Oz | 17.6 MB | 6.8 MB |
| pdfcraft official web app (egui + glow, built from source) | 53 MB | 17 MB |
| Omnitext today: pdf.js + pdfedit chunks | 3.5 MB | about 1 MB |
| Omnitext today: DXF/DWG viewer chunks | 2.7 MB | about 0.6 MB |

The headless wasm is 16.4 MB code and only 3.2 MB data. The code is large because the engine
crate drags in everything (a JavaScript interpreter for PDF form scripts, signing, OCR,
redaction, XFA, optimizer). That is a feature-flag job, ideal upstream work (see below).

## What is worth it, and what is not

| Candidate | Verdict | Why |
|---|---|---|
| pdfcraft engine replaces pdfedit | **Worth a serious phase 1** | Far beyond pdfedit: 179 tools, incremental save, annotations, forms, redaction, signing, OCR, page organizing, compare, PDF/A. Text editing keeps source fonts and untouched rows byte for byte. Headless wasm works today. |
| cadcraft engine for DXF and DWG | **Worth phase 2** | Edits DXF, reads and writes DWG, exports PDF/SVG/PNG, and our cadview is read-only. Pre-alpha (38%), so evaluate again at its alpha. |
| deckcraft or BetterOffice for PPTX | **Phase 3, decide at deckcraft beta** | BetterOffice is the safe surgical path today; deckcraft is the bigger prize but rewrites every part. |
| wordcraft instead of richdoc | **Not yet** | docx about 70% and odt about 50% by their own table; richdoc is more faithful today. Revisit at wordcraft beta. |
| gridcraft instead of sheetedit | **Not yet** | Reads .ods as values only (no formulas, no formatting) by their own table; sheetedit does formulas, VBA (vbalang), Power Query plans. |
| figcraft | **No** | Targets .fig and its own format, not a format Omnitext opens. Revisit only if we want a design surface. |
| vectorcraft, photocraft | **Unknown, assess later** | Candidates for SVG/AI and RAW/PSD/TIFF, which we only view. Untested. |
| their egui apps embedded as they are | **No** | No JS API, a closed canvas, not touch-first, 17 MB gzip, no accessibility tree, 8 to 10% localized. |

## Architecture: headless engines behind our own UI

The principle: take their engines, never their interface.

- A new repo, working name **craftbridge** (MIT, ours): a Cargo workspace with one thin
  wasm-bindgen crate per engine (pdf, cad, later deck), each depending on a PINNED git revision
  of the upstream crates. The spike wrapper is the template: an object that owns a Session,
  exposes open, render(page, scale) to RGBA, a small JSON command surface, and save.
- Each bridge ships as an npm package with typed d.ts, loaded lazily by the matching Omnitext
  editor module, running in a Web Worker so a 50 to 85 ms render never blocks the page.
- **Our UI on top**: toolbar, panels, dialogs, i18n (8 locales), accessibility and keyboard
  handling stay in Omnitext's DOM, as they do for every editor today. The engine draws pixels
  (or vectors) onto a canvas and answers hit-tests; the engines already expose pointer tools and
  hit-testing (deckcraft-engine tools.rs, pdfcraft text blocks and object lists).
- **Collaboration**: Omnitext's existing Yjs sharing binds editor models (pdf-collab.ts today).
  An engine session is a different model; start single-user and bind later through the engines'
  own command streams or snapshots.
- **Fonts**: lazy, never embedded. A font service fetches faces on demand (a Japanese face the
  first time a CJK edit happens) from files we host, chosen from licences their asset policy
  accepts (BIZ UD, Shippori, Noto CJK SC from craft-fonts; not our current Adobe-authored file).
- **Size**: a lazy chunk cached by the service worker. At 6.8 MB gzip the pdf bridge is about 7x
  today's PDF stack, acceptable if loaded only for PDFs and trimmed by feature flags; the APK
  carries it too.

### Phones

Their UIs offer nothing for touch, so mobile is our job and it is a feature, not a cost: a
touch-first PDF and CAD surface is something none of them has. Plan: a pinch-zoom and pan
canvas with tiled rendering (the engine renders tiles natively), tap to select a text block,
long-press for the context menu, a bottom sheet for formatting, and large hit targets, reusing
the layout patterns of Omnitext's existing mobile editors. The edit model is already
paragraph-and-object based, which suits touch better than caret-and-glyph editing.

## Risks

- **Alpha software that moves daily.** Hundreds to thousands of open issues, vendored and
  patched third-party crates (pdfcraft vendors patched hayro-* crates), version bumps every few
  days. Pin exact revisions, upgrade deliberately, keep pdfedit selectable behind a setting
  until the new engine passes our corpus.
- **AI-generated code at scale.** Fine to build on if we test, risky if we trust: our own
  corpus and round-trip tests are the safety net, plus their stated policies (no unwrap/panic).
- **F-Droid.** The recipe must build the wasm from Rust source: a Rust toolchain plus the
  wasm32 target in the build environment, git dependencies (a winit fork and craft-libs appear in
  the app workspaces; the headless crates may avoid them, to verify), and the build already
  takes about 85 minutes. Vendoring cargo sources per the F-Droid rules may be needed.
- **Fidelity regressions** where today's libraries are stronger (odt, ods, docx corners).
  Mitigation: replace one format at a time, behind a setting, never silently.
- **Trademark and branding**: the ArtCraft name and logos are not open source and must not ship.
  Source licence (MIT OR Apache-2.0) is fine for an MIT app; keep their NOTICE and attribution.
- **Privacy**: the suite has an AI-integration layer (craft-ai-integrations: providers and keys).
  Our bridges must not link it; add a test that the wasm imports no network functions.
- **Contribution norms**: their repos credit AI models through Co-Authored-By trailers
  (craftrules contributors standard). Our own rule is never to add them. Decide before the first
  upstream PR (open question 4).
- **Single thread**: the wasm has no threads; their render pool is native only. Measured
  render times are fine, but very large pages and scanned documents need testing.
- **Memory** on large PDFs in wasm (4 GB cap, one copy per revision) is untested.

## Phases and gates

**Phase 0, spikes (done 2026-10-25).** Results above.

**Phase 1, PDF (go/no-go gate at the end).**
1. craftbridge repo and the pdf bridge (open, render tiles, paragraphs, edit, objects, page ops,
   annotations, forms, save; async worker API). Reuse the spike wrapper.
2. Upstream PR: Cargo features on pdfcraft-engine so a viewer/editor build can drop the JS
   interpreter, signing, OCR, XFA (target: under 4 MB gzip). Second PR: a documented wasm
   facade crate in the workspace.
3. Omnitext editor module behind a flag ("PDF engine: classic or new"), reusing the existing
   toolbar, with the touch interaction layer.
4. Rebuild PDF sharing (Yjs) on the engine's edit stream, replacing pdf-collab.ts: two browsers
   edit the same paragraph, move an object and rotate a page, and converge.
5. Gate: sharing works as it does today, and our corpus (pdfedit fixtures, bz2 manual, the French contract, a Japanese LibreOffice
   PDF, a scanned PDF, a rotated PDF, a password PDF, a 300 page PDF) opens, renders and edits
   at least as well as pdfedit; no crash; save is valid in poppler and Acrobat-class readers;
   gzip size within budget; works in the Android WebView; F-Droid recipe builds it reproducibly.

**Phase 2, DXF and DWG.** Same bridge pattern for cadcraft (the DXF and DWG crates may be usable
alone, which would be much smaller than an engine). Replace cadview's read-only viewer with an
editable one when cadcraft reaches alpha; keep cadview as the viewer fallback.

**Phase 3, presentations.** Ship BetterOffice-based editing (small, surgical) if the earlier
spike's go decision stands, and revisit deckcraft's engine when it reaches beta (the PPTX
round-trip issues 70, 74, 77 closed, corpus tested).

**Phase 4, reassess** wordcraft, gridcraft, vectorcraft and photocraft at their beta stages.

**Omnitext 2.0** = the PDF engine swap, an editable CAD surface, presentation editing and a
real phone interface, with the engines loaded lazily and pinned. It is a major version because
the default PDF engine changes and the PWA download grows for those formats.

## Upstream contributions worth making

- Feature flags to slim the engine crates (the biggest win for us and for their own web build).
- A wasm-bindgen facade crate per app (headless, no egui) with a JS-friendly API.
- Runtime font registration for hosts (exists, needs docs) and a list of accepted licences.
- Touch and pointer-event support in the engines' pointer tools, and a phone layout upstream.
- Fixes found by running the corpora: every bug we hit becomes an issue or a PR.

## Decisions (owner, 2026-10-25)

- Omnitext 2.0 ships with the new PDF engine ON by default and pdfedit dropped from the bundle.
  The pdfedit repo stays (public, MIT), it is just no longer bundled.
- The size (about 7x the old PDF stack) is accepted: the new engine brings the features pdfedit
  was meant to gain (annotations, forms, redaction, signing, page operations, OCR).
- Upstream strategy: fork the engines, carry our changes, send them upstream, sync periodically.

### Fork rules (proposed)

1. Fork under hikashop-nicolas, one fork per app we use (pdfcraft first). Remote "upstream" is
   storytold. Our main is a thin carry set rebased on upstream main, never a drifting copy.
2. Upstream first: every change is a small branch off upstream main, opened as a PR, and also
   merged into our carry branch. Goal: the carry set shrinks to zero.
3. Fork only engine work: feature flags, the wasm facade crate, hit-testing and pointer-tool
   additions, bug fixes. The phone interface is NOT in the fork: it is Omnitext's DOM and
   TypeScript over the engine. An egui phone layout upstream would serve only their app.
4. craftbridge pins an exact fork commit. A nightly job rebases the carry set on upstream main and
   runs our PDF corpus; a failure opens an issue instead of silently moving the pin.
5. Release gate unchanged: 2.0 ships when the phase 1 gate passes, not on a date.

### Known regression to plan for

PDF collaboration (pdf-collab.ts) binds pdfedit's model through Yjs. Dropping pdfedit means
sessions on PDFs stop working until the engine's edits are bound to Yjs again. Decide before 2.0:
rebuild it on the engine's edit stream, or ship 2.0 with PDF sharing temporarily off and say so.

- Contribution policy: no AI co-author trailer by default, in our repos and in upstream PRs. Only
  if an upstream maintainer makes it a condition of merging, add it to that PR's commits and
  nothing else (and tell the owner first).
- PDF sharing is rebuilt on the new engine BEFORE 2.0 ships. It is part of the phase 1 gate.
- craftbridge is a public MIT repo under hikashop-nicolas, like the other libraries, with the
  GitHub watch subscription set right after creation.

## Open questions for the owner

1. Who tests on phones, and which devices (the Android debug build on the connected phone is the
   obvious first one)?

## What was NOT tested

pdfedit versus pdfcraft head to head on the same edits, scanned PDFs and OCR, forms, signatures,
password PDFs in wasm, very large PDFs and memory, Android WebView, F-Droid build, DXF editing
commands (only read, render and DWG round trip), vectorcraft, photocraft, filmcraft, soundcraft.

## Progress log

**2026-10-26, phase 1 started.** Fork hikashop-nicolas/pdfcraft (branch `carry` = upstream main plus
the wasm module, `upstream` remote storytold). craftbridge repo created (public MIT, watch set):
worker, promise API, build script, handler tests; the real wasm engine passes the open, render, edit,
save, reopen, page-ops and undo tests in Node. Upstream PR 4803 (the wasm module crate, docs, one
layers line) and issue 4804 (optional JavaScript interpreter: boa and friends are about 4.4 of 17.5 MB
of code). Measured: 21.2 MB wasm, 6.9 MB gzip before wasm-opt. Upstream merges outside PRs in daily
batches (around 14:00 UTC) and `main` moves about 170 commits a day, so keep PRs small and rebase the
same day. Next: Omnitext editor module behind a flag, tile rendering and touch layer, then PDF sharing.


**2026-10-26, editor parity step.** The new PDF editor (Omnitext 986467f onward) now has object
selection, move and resize, add text and images, cover with white, text styling from a floating bar,
zoom slider, fit page on open, page panel, undo and redo, password prompt; checked on the phone.
Engine side (fork branch feat/wasm-facade, upstream PR 4803): object model API in displayed
coordinates, render guards, warnings. Still missing against pdfedit: find, links, form filling,
annotations and highlights, signing, per-font choice beyond the three families, tile rendering for
deep zoom, save in place and reopen on the phone, PDF sharing (the release gate), F-Droid build.

## PDF feature roadmap (draft, 2026-10-26)

What the new editor does today: view, tiles, find, select text and mark it up (highlight, underline,
strike), links, fill existing form fields, edit and restyle text, add text and pictures, move, resize,
turn, cover, page operations, append another PDF's pages, save in place, share through a session.

What the engine already has, and what each needs from us (facade function, craftbridge call, UI, 8
locales, tests; each facade step is its own small upstream PR):

| Feature | Engine | Our work | Size |
|---|---|---|---|
| Comments: notes, text box, shapes, pen | AddAnnotation, SetAnnotationContents, ReplyToAnnotation, SetAnnotationStatus | a Comment tool, a note editor, list of comments | medium |
| Stamps | AddCustomStamp, standard stamp annotations | a stamp picker, own picture as stamp | small |
| Add form fields | AddField, SetFieldProps, DuplicateField, DeleteField, SetTabOrder | Field tool (text, check, choice, button), properties sheet | medium |
| Fill and e-sign (drawn, typed, picture) | typed_signature_shape, FlattenFillSign, image signatures | a signature pad, saved signatures, place and flatten | medium |
| Protect | Protect, RemoveProtection | password and permissions dialog (credentials stay in the app) | small |
| Certificate signature | sign(), DigitalId, SignOptions | pick a .p12, passphrase prompt, appearance, show validity; a timestamp needs a network call (ask first, like the map tiles) | large |
| Layers | info.layers, visibility, set-layer actions | list with toggles; saved default visibility | small |
| Redaction | ApplyRedactions, ClearRedactions | mark areas, apply | medium |
| Header, footer, watermark, background, bookmarks, attachments | AddHeaderFooter, AddWatermark, AddBackground, AddBookmark, AddAttachment | one dialog each | small each |

Suggested order: comments, stamps, protect, layers (cheap, visible), then form fields, e-sign, then
the certificate signature last, since it needs the most care around keys.

Known engine limits found in testing: a paragraph rewritten in a row-keeping mode (mixed fonts) may be
grouped again as several blocks; an engine fix is carried on the fork (rows whose horizontal scale
differs by under 10 percent group again) and is not part of the upstream wasm PR.

### Status 2026-10-26 evening

Done in the new editor and on the fork: comments (note, text box, rectangle, oval, line, arrow, pen),
stamps (the engine's palette, or a picture), form fields (eight kinds, properties by long press),
e-sign (drawn, typed, picture, check and cross marks, typed text, flatten), certificate signature
(.p12/.pfx, visible or not, certify), a new digital ID (self-signed P-256, saved as .p12), password
protection (written at the next save), layers (view only), signature list.
Limits found: RSA certificates cannot sign in the browser build (P-256 works); a signature timestamp
is not offered (needs a network call); protection is refused inside a shared session so the password
never travels with the edit log.
Not started: redaction, header and footer, watermark, background, bookmarks, attachments, compare.
