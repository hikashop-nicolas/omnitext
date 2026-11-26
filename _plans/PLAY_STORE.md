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
| 1.5 | `store-assets/whats-new-1.5.txt` | Start screen (open, create, recent files); Android Open uses the system picker and Save writes back to the opened file; recent files in the Android app and in Chrome/Edge; a saved file no longer reopens as recovered work; phone layout fixes (Word, Markdown, PDF fit, toolbar folding, light-theme PDF); a loading indicator and faster spreadsheet opening; a Close button back to the start screen; a new sheet on a tall phone scrolls, so it grows; the shape bar folds what does not fit a phone under "..."; shapes can be selected and moved by touch, selecting one closes the cell keyboard, and the fill handle no longer shows over a shape. AAB from run 704 (807d593). |
| 1.6 | `store-assets/whats-new-1.6.txt` | Writing assist (Elaborate, Shorten, Write) rewrites the selection instead of replying to it: Qwen3.5 0.8B on a GPU with f16 shaders, prompts in the passage's language, no repetition penalties; where that GPU is missing (most phones) those actions and the spreadsheet formula helper are hidden and Translate stays. AAB from run 713 (da8e111). |
| 1.7 | `store-assets/whats-new-1.7.txt` | AC-3/E-AC-3/DTS/TrueHD audio decodes in the Android app (libav base path 404 on Capacitor) and ALAC plays again (stale mediabunny fork in the lockfile); JSON tree editor (layout, dark-mode contrast, value/list/object picker, paging for large files); NUL-padded text opens as text, "Open as text" in the hex view, kernel logs no longer taken for JSON/JSON5; AI features ask once before downloading their model (Settings > Downloads for AI features); the unused 23.5 MB onnxruntime wasm dropped from the bundle. Also the first F-Droid version (versionCode 10700, tag fdroid-1.7). AAB from run 743 (aed227d). |
| 1.8 | `store-assets/whats-new-1.8.txt` | The media player's own control bar (docked, touch sized, centre play button, drag to seek, SVG icons) and fullscreen that hides the system bars and uses the cut-out band with a black letterbox; audio files show controls instead of a black area, playback speed keeps the pitch, audio stays in sync; Settings split into General, Sharing and About with the explanations behind an (i); the status bar hidden when it has nothing on it; the start screen's plain text tile opens its document; furigana kept in Word documents; the extract hint points to Open; format pages each show a screenshot, served network-first. AAB from run 790 (237b700). |
| 1.9 | `store-assets/whats-new-1.9.txt` | Translation fixed on devices without WebGPU, where it had never worked (onnxruntime-web 1.25/1.26 refuse the q8 models; pinned to 1.27); audio visualiser (oscilloscope or frequency bars, off under prefers-reduced-motion); the map editor asks before fetching OSM tiles; a lone .xz over 64 KB no longer decompresses damaged; EPUB reader types fixed for epub-js 0.3.103. F-Droid only: Tesseract and onnxruntime built from source and packaged, so OCR and translation download no code there. AAB from run (fill in once CI has built it). |
| 1.10 | `store-assets/whats-new-1.10.txt` | A joiner of a shared document is no longer left read-only: the session records the editor it is shared through, a joiner follows it, and binding now happens on any editor change rather than only at session start; collaboration added to the rich Markdown (Milkdown) and rich HTML (Quill) editors; files opened through Android's "Open with" save back to the file when the sender grants write access, and Save otherwise opens the system document creator instead of the share sheet (issue #48); styled subtitles draw on the frame they belong to (pre-rendered events, and the renderer's offset follows the frame callback); and on the web, a document with no file handle is saved through the browser's own destination picker instead of a download (Chrome has had it on Android since 132). |
| 1.11 | `store-assets/whats-new-1.11.txt` | The F-Droid build packages both LSTM-only Tesseract cores, so a WebView without wasm SIMD (before Chrome 91) no longer falls back to the jsDelivr core: the last open finding of the F-Droid review. Not released yet. |
| 2.0 | `store-assets/whats-new-2.0.txt` | A new PDF editor (forms, e-signatures, redaction, watermark, bookmarks, attachments, comments, stamps; complex forms open); PowerPoint editing (text, shapes, pictures, tables, charts, video, slides, notes, GPU transitions, presenter view); Latin, Greek, Cyrillic, Japanese, Chinese and Korean text; new shortcuts. AAB from CI run 42721221497 (563084d), pushed to Play 2026-11-10. |
| 2.1 | `store-assets/whats-new-2.1.txt` | Fullscreen reading mode for PDF, Word, spreadsheets and images on Android; images get pinch and slider zoom and a bottom bar with OCR and the view switcher; spreadsheet bottom bar, zoom and a phone-sized find bar; a save that stays short of the data fails with an error instead of showing Saved; collaboration relay sockets close with the last session; PDF engine updated to upstream PdfCraft of Nov 9. AAB from CI run 42721221497 (563084d), pushed to Play 2026-11-10. |
| 2.2 | `store-assets/whats-new-2.2.txt` | Sheet music: a score editor for MusicXML, MuseScore, Guitar Pro, ABC and MIDI (edit, play, export as PDF, MP3, WAV, MIDI, Guitar Pro); scan import from photos and score PDFs (v2 symbol model from Hugging Face, onnxruntime packaged for F-Droid); MIDI keyboard practice (wait mode, falling notes, loop, metronome, MIDI output); Word shapes, text boxes, charts and SmartArt; PDFs open in a view mode (links, form filling and text copying; an Edit button brings the tools); export as another format; more XFA forms run. AAB from the latest main run (fill in the run once shipped). |
| 2.3 | `store-assets/whats-new-2.3.txt` | Score sharing: the person who shares a score conducts playback for everyone (session clock, output-timestamp timing, a follower within a few ms of the host over wifi), each device keeps its own parts, zoom and layout, editing off while shared; a sound button per part; Settings > Sound delay; KML and GPX sent as .xml open on the map; Android Open with offered for every declared format type; pinch zoom acts on the document; spreadsheet pinch and drag fixes. AAB from the latest main run (fill in the run once shipped). |
| 2.4 | `store-assets/whats-new-2.4.txt` | Text editor: a bar with find (app-styled find and replace bar, match count, case/regex/word toggles), cursor position (tap for Go to line), text size slider with pinch and Ctrl+wheel zoom anchored under the fingers, fullscreen in the app; DXF/DWG text drawn; RAW shows the largest embedded preview; .stl opens as a 3D model again; dropped files listed in recent files; F-Droid build fetches onnxruntime from Intel's fork when Microsoft's repository is gone. AAB from CI run 44286347884 (a94ab42; the app is identical to 6387df2). |
| 2.5 | `store-assets/whats-new-2.5.txt` | Fonts: installed fonts in documents, spreadsheets, slides and subtitles (Local Font Access, or detection over common names), Get more fonts from the Google Fonts catalog behind a consent dialog (off in the F-Droid build), slide fonts fetched for the engine, PDF letters a subset lacks written in the paragraph's font; slides: add slides from the strip (+ below and between slides, the deck's own layouts); spreadsheets on touch: corner grips, a Cut/Copy/Paste/Clear/Fill bar, auto-scroll while dragging, long-press drags that no longer pan; MKV audio starts from the file head (2.3 s to 0.25 s on 1.8 GB), reachable volume slider; ODT embedded fonts and East Asian font sizes; phone layouts at 320 px (header, PDF menus, slide bottom bar, spreadsheet formatting menu), slideshow starts when fullscreen never settles. AAB from CI run 44641100555 (5e30674; the app is identical to a65eb4e). |
| 2.6 | `store-assets/whats-new-2.6.txt` | MIDI files edited and saved back in place (untouched notes keep their timing and velocity; new and deleted parts, overlaps handled); PDFs play embedded sounds and videos (LibreOffice/Acrobat media clips, Sound/Movie annotations, RichMedia, attached media); any picture Omnitext opens (HEIC, WebP, AVIF, TIFF, PSD, RAW, JPEG XL, SVG) converted when added to a PDF, slide, spreadsheet or Word/ODT/DOC document; JPEG XL pictures open; .xlsm and Excel templates open; PDF engine at upstream PdfCraft main (forms open about 15% faster); collaboration on trystero 0.27. AAB from CI run 45371272674 (152db61; the app is identical to 5f86834). |
| 2.7 | `store-assets/whats-new-2.7.txt` | Fix: EPUB books and Outlook .msg emails open again (bundler CommonJS interop handed epub-js and msgreader over as their exports objects, #66). PDF engine 26.2 to 21.7 MB (Arabic/Thai/Hebrew faces loaded at run time, Devanagari dropped, LSTM Thai line breaking, form-script engine built for size); slides engine 15.4 to 13.3 MB (poster frames and TIFF/WebP pictures from the browser); old @aiden0z/pptx-renderer viewer removed (1.4 MB). AAB from CI run 45431449695 (0775ad8; the app is identical to 3b8518d). |
| 2.8 | `store-assets/whats-new-2.8.txt` | Interface in Italian, Polish, Korean and Turkish (app and every library; fontshelf puts Korean fonts first); spreadsheets in the user's regional conventions (decimal comma, ";" separators, French, German, Spanish, Italian, Polish and Turkish function names checked against Microsoft, local dates and booleans; stored invariant) in cells, the formula bar, data validation and conditional formatting dialogs (which now reopen on a rule to edit it), find/replace and charts, with a setting to keep English formulas (#68); a Name Manager and a working name box; documents: shapes and pictures wrap, layer (bring to front / send to back), drag (wrapped ones to another paragraph), reshape with adjust handles, an icon shape toolbar with panels, ODT drawings and LibreOffice's Word presets drawn as LibreOffice draws them, ODT shape gallery, floats placed from page, margin or paragraph as the file says; files recognised by content when the name says nothing (#53); optional dark document pages in dark mode (#38). AAB from the latest main run (fill in the run once shipped). |

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

> **For the 1.7 listing edit:** the F-Droid description (fastlane/metadata/android/en-US/
> full_description.txt) is the new listing text: it opens on what Omnitext is for (one app that
> opens any file, without the ads, banners, accounts and uploads of per-format apps), and its
> privacy line covers both exceptions, sharing and the AI features' one-time model download that
> the app now asks about first. Copy it here and into the console.
>
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
