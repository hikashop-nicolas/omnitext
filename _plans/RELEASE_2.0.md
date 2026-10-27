# Omnitext 2.0 release checklist

Prepared 2026-10-27 while the owner was away. Nothing here has been released: no version bump,
no tag, no store upload.

## What 2.0 is

The PDF editor now runs on PdfCraft's Rust engine (compiled to wasm, through craftbridge,
see CRAFT_PLAN.md). pdfedit is gone from the app: the classic editor, its collaboration
binding and the dependency are removed. Every build carries the engine, F-Droid included.

## State of the code (main)

- Engine: craftbridge.rev pins craftbridge a4e3e56, which pins the PdfCraft fork's `carry`
  branch at 2daba271.
- Production builds refuse to run without the engine (vite.config.ts); OMNITEXT_NO_PDF_ENGINE=1
  opts out for quick local builds. CI (deploy, ci, android) already builds the engine.
- F-Droid: `scripts/fdroid/build-wasm.sh pdfengine` builds it from source (Rust 1.99 from the
  pinned standalone installers, wasm-bindgen from crates.io, no wasm-opt, so the wasm is about
  29 MB instead of 25.5 MB). The recipe passes CRAFTBRIDGE_DIR to the web build.
- Shortcuts: the host owns Cmd/Ctrl+S, O, K, P and Cmd/Ctrl+Alt+N (new), W (close), F (open
  folder), comma (settings). No editor uses an Alt combination, so these never clash.

## Prepared 2026-10-27 (owner away)

- Branch `release-2.0` (pushed, merged with main): versionName 2.0, fdroidVersionCode 20000, fastlane changelog
  20000.txt (478 characters, the limit is 500) and the store text. Tagging is yours: merge or fast-forward it to main,
  then tag fdroid-2.0 on the final commit.
- The F-Droid recipe for 2.0 is at /tmp/recipe20.yml and in ~/dev/omnitext-fdroid-dryrun/metadata, with `commit:` set
  to the branch tip at the time (2f50c21...). check-recipe.mjs accepts it. The repo's own copy
  (scripts/fdroid/app.omnitext.yml) still says 1.11: update it, with the real tag commit, when you tag.
- A full dry run (`scripts/fdroid/dry-run.sh ~/dev/omnitext-fdroid-dryrun app.omnitext:20000`) was started; its log is
  in the session scratchpad (dryrun20.log). It builds all twelve binaries plus the engine, so it takes hours.
- Engine work since the first checklist: Korean text (NanumGothic through craft-fonts, +2 MB wasm), scripts' sizes and
  positions reach the layout, `xfa.layout` object model, shared script engine and a single layout per event (XFA forms
  open 4 to 6 times faster), arcs drawn, clearing an XFA form skips read-only fields, and 47 real forms (CERFA, IRS,
  USCIS, XFA corpus) pass an open/fill/save/edit/flatten audit without a crash.

## Before tagging

1. Run the F-Droid dry run for real (`docs` section "Dry run" of FDROID_PLAN.md) and check the
   engine step. `scripts/fdroid/in-docker.sh pdfengine` (x86_64 Debian trixie) builds the engine in
   about 4 minutes on top of the downloads and gives a 29.7 MB wasm that opens the XFA corpus.
2. Reproducibility: build the engine twice in clean containers and compare the wasm. If it
   differs, look at embedded paths first (the build remaps WORK and CARGO_HOME).
3. APK size: the F-Droid APK grows by about 7 MB compressed because of the engine.
4. Decide the version (2.0, versionCode 20000), bump `fdroidVersionCode` and `versionName` in
   android/app/build.gradle, add fastlane changelogs/20000.txt, tag fdroid-2.0.
5. Play: same version through the usual runbook (PLAY_STORE.md). Update the store text if it
   mentions the PDF editor's features.

## Draft changelog (user-facing)

New in this update:

- A new PDF editor: forms (fill, add fields, radio groups, drop-downs, buttons with actions and
  JavaScript), e-signatures and certificate signing, redaction, watermark, header and footer,
  bookmarks, attachments, comments and stamps, page tools, keyboard shortcuts like Acrobat's
- Edit and add text in Latin, Greek, Cyrillic, Japanese and Simplified Chinese
- Opens complex forms such as French CERFA and IRS forms, including XFA ones
- New keyboard shortcuts for New document, Close, Settings and Open folder

Still offline unless you choose to share.

## Known limits to mention or fix later

- XFA forms whose scripts use E4X XML literals or the full XFA host object model (LOV drop-down
  lists loaded from script objects, caption.value.resolveNode and similar) show their static
  state; the corpus of 12 dynamic XFA samples opens and lays out, scripts that need those fail
  quietly.
- The PDF engine is a fork carry: fixes not yet merged upstream are on the fork's `carry`
  branch (PRs #4803, #4944, #4948 are open at storytold/pdfcraft).
