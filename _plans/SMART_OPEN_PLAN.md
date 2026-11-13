# Opening PDFs and MIDI files with the right editor

Draft 2026-11-13, reviewed the same day: decisions below.

## Decisions (user, 2026-11-13)

- A score PDF opened with scoredit is scoredit's alone: no View switcher, no pdfcraft tools.
  Ordinary PDFs keep pdfcraft as today.
- Every MIDI opens in scoredit, never mediaplay (no MIDI-to-WAV bridge). A performance MIDI
  opens in the keys layout (keyboard with falling notes) instead of the page; a
  notation-like MIDI opens on the page as now.
- Later: a piano-roll layout in scoredit for played-in MIDI (one lane per track, note bars
  over time, velocity as shade, play cursor, zoom and scroll, in the spirit of subedit's
  waveform lanes), as a fourth layout next to page, line and keys.

## Goal

One file type, two kinds of content:

| File | Kind A | Kind B |
|---|---|---|
| PDF | a score engraved by notation software (MuseScore, Sibelius, LilyPond, Finale, Dorico...) | any other PDF (letters, forms, scans, scanned scores) |
| MIDI | a notation-like file (exported from a score, quantised) | a performance (played in, a GM song file) |

Open each in the editor that fits (scoredit for A, pdfcraft or mediaplay for B) without
asking, and let the person switch with the existing View switcher.

## Today

- Format choice is synchronous: extension, then `detect(text)` or `sniffBytes(first 16
  bytes)`. `resolveEditor` then takes the format's native/default editor, or a per-format
  override from settings (`preferredByFormat`).
- PDF: format `pdf`, editor pdfcraft only; the View switcher is hidden for pdfcraft.
- MIDI: format `midi`, scoredit only (`soleEditor`); `mediaFormatForFile` keeps .mid out of
  mediaplay. mediaplay cannot play MIDI (it decodes recorded audio).

## Design

### 1. A per-document editor pick (core)

Add an optional `pickEditor?(bytes: Uint8Array, filename: string): string | null` to
FormatDescriptor: a fast, synchronous look at the content that returns the editor id that
fits this document, or null for the format's default. Order in `resolveEditor`:
1. a choice the person made for this file (remembered per file key, see 4),
2. `pickEditor`,
3. the per-format override from settings,
4. the format's default.

Synchronous on purpose: it runs on the bytes already loaded, before anything is drawn, so
the file never opens in one editor and jumps to another. Budget: a few milliseconds.

### 2. PDF: is it a score?

`pickEditor` for `pdf` scans the bytes, no parsing:
- Music fonts named in font dictionaries (`/BaseFont /ABCDEF+Leland`): Bravura, Leland,
  Petaluma, Finale Maestro/Broadway/Jazz/Ash, Sebastian, Opus (Std, Special...),
  Maestro, Sonata, Petrucci, Emmentaler, feta, Gootville, Leipzig... (the list in
  scoredit's normalize.ts, exported from scoredit so both stay in step).
- Producer/Creator strings: MuseScore, Sibelius, Finale, LilyPond, Dorico, Notion,
  Guitar Pro, NoteWorthy, capella, Encore, ScoreCloud, Flat, Noteflight, MuseScore Studio.
- Score if a music font is named (strong signal), or a notation program is the creator and
  the file has no pages that are only images. Otherwise pdfcraft.

Limit: a PDF that compresses its dictionaries into object streams (PDF 1.5+) hides the font
names from a byte scan. Then scan the first object streams' inflated text (fflate is
already in the app; cap the work, e.g. the first 2 MB) before falling back to pdfcraft.

Scanned scores (images only) stay in pdfcraft; once scan import (oemer) exists, they get a
"Read as score" action rather than an automatic switch, since the result is a draft.

### 3. MIDI: notation or performance?

scoredit's `isNotationMidi(bytes)` reads the header and events:
- Notation-like: time-signature and key-signature meta events, track names, onsets on a
  grid (most within a few ticks of a 16th or triplet grid at the file's division), few
  tempo changes, note lengths that are whole grid values.
- Performance: onsets off the grid (played in), many tempo or controller changes
  (expression, sustain pedal streams), very long files.

Both open in scoredit. Omnitext passes the viewer's starting layout: page for
notation-like, keys for a performance. The person can still change layout from the bar.

### 4. No switching

- A score PDF in scoredit has no View switcher and no pdfcraft tools (decided).
- MIDI only ever opens in scoredit; the layout is the only choice, in scoredit's own bar.
- When detection picked scoredit for a PDF and reading fails (unknown font, empty result),
  the file opens in pdfcraft with a short notice instead of an error page.

### 5. Where the code goes

- Omnitext: `pickEditor` in FormatDescriptor and resolveEditor; the `pdf` format gets
  scoredit as its editor when the PDF is a score (pdfcraft otherwise); MIDI passes the
  starting layout to the score viewer.
- scoredit: export the music-font list and a `isScorePdf(bytes)` / `isNotationMidi(bytes)`
  pair so the logic lives next to the readers and is unit tested there; Omnitext's
  pickEditor just calls them.

## Steps

1. scoredit: `isScorePdf` (byte scan, object-stream fallback) and `isNotationMidi`, tests on
   the corpus (all corpus PDFs from MuseScore, the LilyPond and Sibelius samples, some
   ordinary PDFs: none misdetected) and on MIDI (corpus MIDI exported by MuseScore vs
   performance MIDIs).
2. Omnitext core: `pickEditor` in resolveEditor.
3. PDF: scoredit for score PDFs through its PDF reader (needs the reader merged), no
   switcher; fallback to pdfcraft with a notice on failure.
4. MIDI: starting layout from `isNotationMidi` (keys for a performance).
5. Tests: routing unit tests; e2e: a MuseScore PDF (score), an ordinary PDF (pdfcraft), a
   notation MIDI (page), a performance MIDI (keys).
6. Later: the piano-roll layout in scoredit.

## Done 2026-11-13

- scoredit 17efb6d: `isScorePdf` (music font named in a font dictionary, object streams
  inflated, 1 MB chunks with early exit; every corpus and engraver sample a score, ordinary
  PDFs and scans not; at most 41 ms on a 3.5 MB scan), `isNotationMidi` (75% of onsets on a
  32nd/triplet/quintuplet/septuplet grid; MuseScore exports 99.6%, played-in timing about
  40%), `pdfNotationApp`.
- Omnitext: instead of a core `pickEditor` hook, score PDFs are routed in openBuffer (the
  read is async and can fail; the core resolver stays synchronous): `isScorePdf`, then
  `readPdfScore` to MusicXML, opened as the `score-pdf` format (score editor only, no
  switcher, read-only through a new format-level `readOnly`); a failed read falls back to
  pdfcraft with a notice. MIDI: the score editor starts in the keys layout when
  `isNotationMidi` says played-in. Checked live: MuseScore and LilyPond PDFs open as scores,
  a played-in MIDI in keys.
- Next: a PDF that scoredit exports carries its MusicXML as an embedded file, so it reopens
  as the exact score (those PDFs draw notation as paths, so they are not detected today).
- Local note: vendor/craftbridge is older than Omnitext expects (no `pdfFontFaces`), so
  pdfcraft fails to load in a dev server pointed at it; unrelated to this work.

