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

## Before tagging

1. Run the F-Droid dry run for real (`docs` section "Dry run" of FDROID_PLAN.md) and check the
   engine step; the first attempt of `scripts/fdroid/in-docker.sh pdfengine` is noted below.
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

- Korean text cannot be added to a PDF.
- XFA forms whose scripts use E4X XML literals or the full XFA host object model (LOV drop-down
  lists loaded from script objects, caption.value.resolveNode and similar) show their static
  state; the corpus of 12 dynamic XFA samples opens and lays out, scripts that need those fail
  quietly.
- The PDF engine is a fork carry: fixes not yet merged upstream are on the fork's `carry`
  branch (PRs #4803, #4944, #4948 are open at storytold/pdfcraft).
