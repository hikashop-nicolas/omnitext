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

## Store assets

All generated and in `store-assets/`: `icon-512.png` (512x512 store icon),
`feature-graphic.png` (1024x500), and `screenshots/`. Regenerate the screenshots when
the UI changes noticeably.

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
> - Spreadsheets with charts, pivot tables, Power Query, conditional formatting and more.
> - Code and data editor with syntax highlighting for many formats.
> - Edit subtitles (SRT, VTT, ASS and more) and play video and audio with subtitles.
> - Edit maps (GeoJSON, KML, GPX) and view many more formats: PowerPoint, ebooks,
>   3D models, fonts, SQLite databases, email and images (with on-device OCR).
> - Command palette, light and dark themes, and version history to roll back changes.
> - Private by design: nothing leaves your device.

Keep this in step with what the app actually does. Collaboration, when it ships, changes
the "nothing leaves your device" claim and the Data safety answers below, so both need
revisiting before that release goes out (see `COLLABORATION_PLAN.md`).

## Console answers (for re-declarations)

- Privacy policy: the URL above.
- Data safety: **no data collected, no data shared.** Encrypted in transit: not
  applicable. Data deletion: not applicable (local data is cleared by clearing app
  storage).
- Ads: **no ads.**
- Content rating: Utility/Productivity; no violence, sexual content, profanity,
  controlled substances, user-to-user content or data sharing. Rated Everyone / PEGI 3.
- App access: all functionality available without special access; no test credentials.
- News app: no. Government app: no. Financial features: no.
