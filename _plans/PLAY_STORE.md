# Omnitext on Google Play

Published. This is the standing runbook for shipping a release, plus the console
answers and listing copy, kept so they stay consistent between releases.

The original publication checklist (account creation, the 12-tester/14-day closed test,
policy declarations, the first production submission) is done and archived in
`archive/PLAY_STORE_PUBLICATION.md`.

## Shipping a release

1. Bump `versionName` in `android/app/build.gradle`. The version code comes from CI
   (the run number), so it always increases on its own and never needs touching.
2. Write `store-assets/whats-new-<version>.txt`, and add a row to the table below.
3. Push to `main`. The "Build Android APK" workflow produces a signed AAB.
4. `gh run download <run-id> -n play-aab` to get `omnitext.aab`.
5. Upload it to the Play Console track, paste the matching `whats-new-*.txt` as the
   release notes, and roll out.

## Releases

| versionName | Notes file | Summary |
|---|---|---|
| 1.0 | (initial) | First closed-test build (2026-07-09). |
| 1.1 | `store-assets/whats-new-1.1.txt` | .doc editing, spreadsheet charts/pivots/Power Query, subtitle editor, media player, many new viewers, map editor, command palette, themes. |
| 1.2 | `store-assets/whats-new-1.2.txt` | Spreadsheet VBA macros, form/ActiveX controls, printing, protection, freeze/split panes, outline grouping; richer .doc editing; ALAC audio; the Android "Open with" fix for large files; version-history fixes. |
| 1.3 | `store-assets/whats-new-1.3.txt` | Live collaboration (invite-only, with cursors and chat), printing through Android, DWG/DXF drawings, the build number and update check in Settings, the "Open with" recovery fix. |
| 1.4 | `store-assets/whats-new-1.4.txt` | Spanish, German, Portuguese, Russian and Chinese; spreadsheet shapes (gallery, rotation, format bar), coloured sheet tabs, a grid that grows as you scroll, cells that keep their formatting when selected; .7z save-back, lone .xz/.bz2; opening a file whose type nobody recognises. |
| 1.5 | `store-assets/whats-new-1.5.txt` | Start screen (open, create, recent files); Android Open uses the system picker and Save writes back to the opened file; recent files in the Android app and in Chrome/Edge; a saved file no longer reopens as recovered work; phone layout fixes (Word, Markdown, PDF fit, toolbar folding, light-theme PDF); a loading indicator and faster spreadsheet opening; a Close button back to the start screen; a new sheet on a tall phone scrolls, so it grows; the shape bar folds what does not fit a phone under "...". shapes can be selected and moved by touch, selecting one closes the cell keyboard, and the fill handle no longer shows over a shape. AAB from run 704 (807d593). |

## Store assets

All generated and in `store-assets/`: `icon-512.png` (512x512 store icon),
`feature-graphic.png` (1024x500), and `screenshots/`. Regenerate the screenshots when
the UI changes noticeably.

The screenshots (1.5) are captured on a phone, in English and the light theme, and cropped to
1080x2160 (below the status bar, above the navigation bar): start screen with recent files,
Word, spreadsheet, PDF, Markdown. The documents in them are invented demo files, so no real
name, address or number ever appears in the store listing.

Privacy policy URL: https://hikashop-nicolas.github.io/omnitext/privacy.html

## Listing copy

**App name**: Omnitext

**Short description** (<= 80 chars):
> Private, offline editor for text, code, PDF, Word, spreadsheets and more.

**Full description**:
> Omnitext is a private, offline editor that adapts to whatever file you open: code and
> data formats (JSON, YAML, XML, CSV, Markdown and more) in a proper editor, and PDF,
> Word (.doc/.docx), OpenDocument (.odt) and spreadsheets (.xlsx/.ods) in dedicated
> editors, all on your device.
>
> Everything runs locally. Your files are never uploaded, there is no account, no
> tracking, and no ads. Open a file, edit it, and save it back, entirely offline.
>
> - Edit PDFs: change text in place, add text and images, pinch to zoom.
> - Edit Word (including legacy .doc), OpenDocument and spreadsheets, preserving the
>   parts you do not touch.
> - Spreadsheets with charts, pivot tables, Power Query, conditional formatting, printing,
>   freeze and split panes, form controls and VBA macros that run.
> - Code and data editor with syntax highlighting for many formats.
> - Edit subtitles (SRT, VTT, ASS and more) and play video and audio with subtitles.
> - Edit maps (GeoJSON, KML, GPX) and view many more formats: PowerPoint, ebooks,
>   3D models, fonts, SQLite databases, email and images (with on-device OCR).
> - Command palette, light and dark themes, and version history to roll back changes.
> - Private by design: nothing leaves your device.

Keep this in step with what the app actually does.

> **Outstanding since 1.3: collaboration shipped, and the copy above did not change with
> it.** "Private by design: nothing leaves your device" is no longer true without a
> qualifier: a shared session sends the document to the peers the user invites, directly
> between the two browsers (and through a relay only when the user configures one). It is
> still true that the app has no account, no tracking, no ads and no server of ours holding
> anything. Suggested replacement for the last bullet, to use on the next listing edit:
>
> > - Private by design: nothing leaves your device unless you share a document, and then
> >   it goes straight to the people you invite.
>
> The Data safety answers need the same look (see below) before the next listing edit.

## Console answers (for re-declarations)

- Privacy policy: the URL above.
- Data safety: **no data collected, no data shared.** Encrypted in transit: not
  applicable. Data deletion: not applicable (local data is cleared by clearing app
  storage).
  - **Needs re-declaring since 1.3.** A shared session moves the document off the device.
    Google's form exempts a transfer the user themselves asked for to a recipient they
    chose, so "no data shared" is arguable, but "encrypted in transit: not applicable" is
    not: the session is WebRTC, which is encrypted end to end. The answer to check in the
    console is that one. Nothing here is collected by us either way: no server of ours
    ever holds the document.
- Ads: **no ads.**
- Content rating: Utility/Productivity; no violence, sexual content, profanity,
  controlled substances, user-to-user content or data sharing. Rated Everyone / PEGI 3.
- App access: all functionality available without special access; no test credentials.
- News app: no. Government app: no. Financial features: no.
