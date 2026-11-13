# Opening PDFs and MIDI files with the right editor

Draft 2026-11-13, for review.

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

`pickEditor` for `midi` reads the header and events (a small parser, no scoredit needed):
- Notation-like: time-signature and key-signature meta events, track names, onsets that sit
  on a grid (most within a few ticks of a 16th or triplet grid at the file's division),
  few tempo changes, note lengths that are whole grid values.
- Performance: onsets off the grid (played in), many tempo or controller changes
  (expression, sustain pedal streams), drum channel with GM-song density, very long files.
- Score if notation-like, else mediaplay.

mediaplay needs MIDI playback for this. Recommended: Omnitext renders the MIDI to audio with
scoredit's renderer (`readMidi` then `renderAudio`, recorded instruments when allowed, the
built-in synth otherwise; about 9 s for 2.5 minutes of piano) and hands mediaplay a WAV in
memory, with a progress line while it renders. No MIDI code in mediaplay itself, no second
synthesizer to maintain. Cost: a wait before playback starts; later, render the first
seconds first and stream the rest.

### 4. Switching, and remembering

- Show the View switcher for PDF and MIDI whenever both editors are candidates (today it is
  hidden for pdfcraft): "Score" and "PDF" / "Score" and "Player".
- A switch made by the person is remembered for that file (by file key, as recent files
  are) and wins over detection next time. No global setting needed; the existing
  per-format preference keeps working for people who always want one or the other.
- When detection picked the score editor and reading fails (unknown font, empty result),
  fall back to pdfcraft or mediaplay with a short notice instead of an error page.

### 5. Where the code goes

- Omnitext: `pickEditor` in FormatDescriptor and resolveEditor; `pdf` and `midi` formats get
  scoredit as a second candidate editor (the score editor consuming a "score" view from
  them); View switcher rules; per-file memory; the MIDI-to-WAV bridge into mediaplay.
- scoredit: export the music-font list and a `isScorePdf(bytes)` / `isNotationMidi(bytes)`
  pair so the logic lives next to the readers and is unit tested there; Omnitext's
  pickEditor just calls them.

## Steps

1. scoredit: `isScorePdf` (byte scan, object-stream fallback) and `isNotationMidi`, tests on
   the corpus (all corpus PDFs from MuseScore, the LilyPond and Sibelius samples, some
   ordinary PDFs: none misdetected) and on MIDI (corpus MIDI exported by MuseScore vs
   performance MIDIs).
2. Omnitext core: `pickEditor`, per-file remembered choice, View switcher for PDF/MIDI.
3. PDF: score editor as candidate for `pdf`, opened through scoredit's PDF reader (needs the
   reader merged first); fallback to pdfcraft on failure.
4. MIDI: mediaplay as candidate for `midi` via the WAV bridge; drop `soleEditor`.
5. Tests: routing unit tests; e2e: open a MuseScore PDF (score), an ordinary PDF (pdfcraft),
   a notation MIDI (score), a performance MIDI (player); switch and reopen (remembered).

## Open questions

- Should a score PDF opened as a score still offer pdfcraft's tools (annotate, sign) in the
  same session, or only through the switcher? Proposed: the switcher.
- MIDI in mediaplay: is a few seconds of rendering before playback acceptable, or should a
  performance MIDI rather open in the score editor's player (no notation shown, piano roll
  view)? Proposed: the WAV bridge, since a performance MIDI shown as notation looks broken.
