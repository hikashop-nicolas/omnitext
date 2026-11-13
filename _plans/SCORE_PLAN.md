# Sheet music: scoredit, a score viewer and editor for Omnitext

In progress since 2026-11-10: phase 0 (spike) done, phase 1 next. Decisions so far are in "Decided"; open points at the end.

## Goal

Open, play, edit and create music scores in Omnitext, starting with MuseScore files.
As with pdfedit / richdoc, the work lives in a standalone MIT library, **scoredit**
(`~/dev/scoredit`), consumed by Omnitext as a git dependency.

## Decided (2026-11-10)

- **Editing from the start**, with real note entry that works on phone and desktop.
- **OSMD** (BSD) renders. No webmscore (GPL, MuseScore 3, dead since 2023), no Verovio
  unless OSMD proves unworkable.
- **Permissive licences only** (MIT / BSD / Apache / ISC / CC0 / OFL). That rules out
  alphaTab (MPL + compulsory on-score watermark) for Guitar Pro.
- **MuseScore files are written back** in place; an **Export** button lets the user pick
  another format (MusicXML, mxl, MIDI, PDF/SVG, ...).
- **Playback** is in, with three views inspired by musescore.com: the score with the
  playing notes highlighted, an optional piano keyboard under it with the keys lit,
  and a "falling notes" game view (no score, notes drop onto the keyboard, one colour
  per hand).
- **Sound needs no download to start**: a built-in synth plays instantly; a sampled
  instrument pack is an optional download for realistic sound.
- **Guitar Pro is written back too** (GP7 `.gp` is a zip with GPIF XML); our own writer.
- **One release**: the version that ships scores ships editing too.
- **Repo**: `hikashop-nicolas/scoredit`, public, MIT, created after the spike.
- **Test corpus** gathered from openly licensed online sources, plus musescore.com
  downloads (user's account) kept local.

## Progress (2026-11-11)

- Phase 0 spike done; scoredit repo created (hikashop-nicolas/scoredit).
- Phase 1 viewer: page layout (one OSMD per system, virtualized, fitted line breaks), bottom
  bar, zoom + pinch, fullscreen hook; in Omnitext for .musicxml/.mxl/.xml scores (read-only).
- Line layout (one long line sideways, fitted to the height) for playing along.
- Phase 3 playback: webaudio-tinysynth (vendored), timeline with repeats, endings, D.C./D.S./
  Fine/Coda, ties, tempo, dynamics, transposition, grace notes; highlighted notes + cursor,
  speed, tap to play from a beat; keyboard strip and falling-notes view.
- Phase 2 MuseScore reading (MS3 + MS4): same notes as MuseScore's own MusicXML export on
  the corpus (`npm run test:corpus`), play order checked against its MIDI export. Repeats and
  D.C. stay inside a section; Fine resumes after the jump. MuseScore 2 files too; pedal,
  trill lines, tremolos and tab staves from instrument parts are read.
- Playback polish: recorded instruments (scoredit-sounds, per-instrument SF3 on jsDelivr,
  downloaded after a consent prompt), plucked-string model, fretboard strip, TAB toggle.
- Parts: a Parts button shows only the ticked parts (playback keeps them all); Omnitext's
  My instrument setting opens multi-instrument scores on that instrument. Short part names
  on every system. Next system scrolled in halfway through the current one.
- Phase 4 started (2026-11-11): ScoreEditor (overwrite + insert entry, chords, rests,
  lengths, ties, transpose, accidentals, remove, undo/redo); Edit button + palette, tap and
  long-press entry with pitch bubble, keyboard strip, MuseScore keys; one system redrawn in
  place per edit; MusicXML/mxl editable and saved in Omnitext. Then triplets, range select +
  copy/cut/paste, drum entry (the drum on that line, named in the bubble), fretboard strip
  with string/fret and tab staves rewritten from notation; all checked on the phone.
- Phase 4 done (2026-11-12): marks of every kind (articulations, ornaments incl. turns and
  ornament accidentals, fermatas, slurs, grace notes and grace chords, lyrics, tremolos,
  arpeggios, glissandos/slides, trill lines, fingerings, bowings, hammer-ons, pull-offs,
  bends, taps, plucks, holes, arrows); the Marks row shows what suits the part's instrument
  family (All marks shows the rest); desktop palette on one line when it fits.
- Tests: `npm run test:e2e` (36 scenarios in headless Chrome, desktop and phone, with a
  plain-words report; Für Elise typed back in from the keyboard) and `npm run test:rebuild`
  (every corpus score emptied and re-entered through the editor, compared note by note and
  mark by mark: 66/66 exact, the 1812 Overture included).

## Next (2026-11-12)

1. **MuseScore write-back (phase 5), shipped 2026-11-12, manual check pending.** Only the
   edited measures are written again; Omnitext edits and saves .mscz/.mscx. `npm run
   test:save` in scoredit checks every corpus file in our reading and in MuseScore's (49 of
   49 writable files exact). Saves now reach MuseScore's instrument parts (Excerpts in 4,
   nested scores in 3; multi-measure rests are dropped there and MuseScore makes them
   again). MuseScore 2 files stay read-only (decided). Then a manual check in MuseScore 4
   by the user.
2. **Editing breadth (phase 6), done 2026-11-12.** Dynamics, hairpins, text, tempo and
   rehearsal marks; transpose; key, clef and time changes (time re-bars, refused across
   repeats and tuplets); adding and deleting bars; chord symbols; instruments (add,
   remove, change); a new-score dialog in Omnitext's New dialog, written as .mscz from
   scoredit's own instrument table. A bar floats over the selected notes for what changes
   them (accidentals, Marks, Dynamics, Text, delete); the Score row has four groups.
   Known: MuseScore 4 lists an extra part for a changed instrument in a converted MuseScore
   3 file; reordering instruments and changing their staff count are not there yet.
3. **More formats (phase 7), done 2026-11-12** (scoredit 3e6c920, Omnitext c916078 and
   685c72d). ABC with `&` overlays and %%score/%%staves; Guitar Pro 3-7 including .gpx
   (sniffed apart from GPS tracks), all 250 corpus files open, 215 match MuseScore exactly;
   GP7 files edit and save, and Export as writes Guitar Pro 7 (331 corpus round trips,
   MuseScore imports every written file) and MIDI (96.5% of MuseScore's notes). MIDI import
   rewritten (99.94% onsets on round trip). Leftovers closed 2026-11-13 (scoredit, see
   below): ABC middle=, stafflines=, later %%score, s: lines, P: play order, %%MIDI
   program/channel/drummap and %%percmap (drums play and sit on a one-line staff); GP
   harmonic fret and sounding pitch, GP3-6 drum keys, GP7 transposition (218/249 exact);
   MIDI import keeps a fifth line and reads tuplets over 2 or 4 beats; fermatas, caesuras
   and section ends pause in playback and MIDI export; a system OSMD wraps is cut where it
   wraps. Then (scoredit e4d0510): GP4/GP5 artificial harmonics sound where the file says
   (guitarpro-parser swaps GP4's +5/+7 and drops GP5's accidental); a short last system is
   evened out with the one before. Settled, nothing to do:
   - GP7 pickup: our reader reads it back as a pickup (tested); MuseScore ignores
     `<Anacrusis />` in any form and no real file has one.
   - Harmonics.gp3: GP3 stores only a flag, we play the octave; MuseScore drops GP3
     harmonics, so it stays a known difference.
   - A G clef on line 1 is a correct French clef (measured against plain OSMD).
   - MuseScore pause values (scoredit 68094d0): fermata timeStretch, section-break and
     breath pauses and the six fermata shapes now play; export within 50 ms of MuseScore
     went from 56% to 81% of notes. Internal scoredit-stretch/scoredit-pause attributes,
     stripped from exported MusicXML, written back to MuseScore files.
   - sq_sq10328092 still drifts: MuseScore plays a repeat after a section pause at the next
     section's tempo; we keep the section's own (musically right, not copied).
   Still open: a fermata on the barline after a voice's last chord does not play; one guitar
   riff book lines up poorly with MuseScore (not investigated).
4. **Audio export (MP3, WAV), done 2026-11-13** (scoredit f2b9d8a, Omnitext ad813f2).
   `exportMp3`/`exportWav`: recorded instruments rendered straight through spessasynth
   (velocities mapped to 64+v/2, chosen by ear: "fast-bright"), the rest through the
   built-in synth in an OfflineAudioContext; rusty_mp3 (Apache-2.0) built to wasm from
   scoredit wasm/mp3 by scripts/build-mp3-wasm.sh, 140 KB, inlined as base64 and loaded on
   first use, gapless Info frame. Für Elise: about 9 s in Chrome (was 32 s through per-note
   buffers). Runs on the main thread in 30 ms slices with progress; Omnitext shows a
   percentage pill. Playback now holds recorded and plucked notes under the pedal. Not
   done: a worker (spessasynth in a worker needs bundling work), overlapping render and
   encode, MP3 bitrate choice in the UI.
   MuseScore timing (scoredit e22cbd5, 2026-11-13): trills, turns, graces, tremolos and
   arpeggios timed as MuseScore plays them; notes within 50 ms of MuseScore's MIDI 80.6% to
   82.7%. The rest: MuseScore plays a repeat after a section-break pause at the next
   section's tempo (15.8 points, 99.3% if imitated): a MuseScore bug, decided NOT to copy
   (user, 2026-11-13). MuseScore also sounds linked tab staves and cross-voice unisons twice
   (0.6 points, deliberate). A barline fermata does not hold in MuseScore either (checked):
   nothing to do.
5. **PDF export and print (planned 2026-11-13).** Export as gains PDF: the score laid out on
   A4/Letter pages (title, page numbers, systems kept whole) as vector graphics, from the
   SVG OSMD draws per system. Converter to pick: svg2pdf.js + jsPDF (MIT) or SVG paths into
   pdf-lib (already in Omnitext through pdfedit). The same paged rendering backs a proper
   Print: today the score gets Omnitext's Print button but prints the live page view, which
   keeps only the systems near the screen drawn, so a long score prints incomplete
   (unverified). Page size from the score's own page settings when it has them, else the
   locale's (A4 or Letter). In scoredit (exportPdf(score, opts) like exportMp3), Omnitext
   adds the export target and printable().
6. **PDF and scan import: research spike first (planned 2026-11-13), then a go/no-go.**
   - Vector PDFs from notation software (MuseScore, Sibelius, Dorico, Finale, LilyPond):
     glyphs of music fonts (SMuFL Bravura/Leland, Emmentaler, older Maestro/Opus) at exact
     positions, staff lines and stems as paths; pdf.js extracts both. Rebuilding notation
     from them is deterministic. To test: how each program embeds and subsets its fonts
     (are SMuFL code points kept?), on real exports.
   - Scans and photos: optical music recognition. Audiveris is AGPL (excluded). Survey
     permissively licensed models (code AND weights) that could run in the browser
     (onnxruntime-web, as localml does for OCR), and their accuracy on clean scans. Output is
     a draft to correct, not a faithful copy.
   - Spike output: findings with evidence, a recommendation, and effort, for the user to
     decide.
   - Spike done 2026-11-13. Vector PDFs: MuseScore 4 PDFs keep SMuFL code points as text
     (329 U+E0A4 noteheads on Für Elise p.1, clefs, rests, accidentals, flags, dots);
     staff lines, stems, barlines are stroked paths (merge per-measure pieces). An 80-line
     pdf.js prototype finds staves and reads pitches (opening E5 D5 E5 D5 E5 B4 D5 C5 A4,
     bass A2 E3 A3 correct); misses ledger lines vs staff lines, accidentals, durations.
     Estimate 2-3 weeks to a useful MuseScore-PDF reader; other engravers untested (need a
     download: LilyPond via Homebrew, Mutopia/IMSLP samples). Scans: only oemer is
     permissive (code MIT, checkpoint licence to confirm, ONNX, 3-5 min/page with a GPU,
     no handwriting); homr, Audiveris, OpenOMR are (A)GPL; LEGATO full is gated on Llama
     3.2, legato-small (MIT) is a baseline; SMT licence unknown. Recommendation: build the
     vector reader first, revisit scans later.
   - Round 2 (downloads allowed, 2026-11-13): LilyPond PDFs (Emmentaler) renumber glyph
     codes but keep glyph names in the embedded CFF; Sibelius 7 (OpusStd) uses the legacy
     Sonata-compatible layout (shared with Finale's Maestro): three mappings cover the
     engravers seen. Scans, Für Elise p.1 made scan-like: oemer (MIT, 235 MB checkpoints,
     about 5 min CPU per page) got 86.5% of right-hand and 77.5% of left-hand pitches right
     (67.6% / 55.1% with note values); SMT (MIT, 21M params, needs commit e2c1133 to load
     its weights, about 17 s per grand-staff system) mostly right melody, wrong meter, weak
     bass; full-page SMT++ weights gated (Hugging Face account). Both give drafts only.
   PDF export done 2026-11-13 (scoredit fbe5d30, Omnitext 5543b65): OSMD paged mode (A4_P /
   Letter_P, zoom 0.7) drawn by jsPDF + svg2pdf.js (MIT, lazy); fixes for an open volta
   (MuseScore export without stop) and pt font sizes (svg2pdf reads them as 0). Für Elise:
   4 pages, 1.6 s; a 15-minute quartet: 37 pages, 7 s. Print goes through printableFile()
   with the same PDF. Not yet: progress for the layout step itself (one blocking render),
   non-Latin text (jsPDF standard fonts only), a live check in the Omnitext app.
7. **Import from notation-software PDFs (decided 2026-11-13: build it).** In scoredit,
   `readPdfScore(bytes)` to a MusicXML document, opened like any other format.
   - Extraction: pdf.js (pdfjs-dist, Apache-2.0, lazy, no worker needed): text items with
     positions and fonts, stroked/filled paths with the transform tracked.
   - Symbol layer: every music glyph normalised to a SMuFL name. Three font families:
     SMuFL code points (MuseScore, Dorico, newer Sibelius/Finale); the legacy
     Sonata-compatible layout (Sibelius Opus, Finale Maestro, Petrucci...) by a fixed table;
     LilyPond Emmentaler by glyph names read from the embedded CFF charset. Unknown fonts:
     report, do not guess.
   - Geometry: staves (five evenly spaced lines, pieces merged), ledger lines (short lines
     outside a staff), systems (staves joined by a system barline or brace), barlines
     (vertical lines spanning staves), stems (thin verticals touching a notehead), beams
     (filled quadrilaterals between stems), ties and slurs (curves), hairpins.
   - Notation: per staff and bar, chords from noteheads sharing a stem, voices from stem
     direction and timing, durations from notehead + flags/beams + dots + tuplet numbers,
     accidentals and key/time signatures, clefs (and changes), rests, lyrics and text from
     the text fonts, part names from the left margin, then MusicXML.
   - Test bed: every corpus score exported to PDF by MuseScore (`mscore -o x.pdf`) gives a
     PDF with the exact MusicXML to compare against: measure count, pitches, durations per
     staff (edit distance, like the scan spike). Other engravers: Mutopia (LilyPond) and the
     Commons Sibelius samples, checked by eye.
   - Order: SMuFL path end to end first (MuseScore PDFs), then the two other font families.
8. **Scan import with oemer (decided 2026-11-13: after 7).** oemer is MIT, ONNX models
   (235 MB), Python post-processing. Options to weigh when we get there: run its ONNX models
   in the browser with onnxruntime-web (WebGPU) and port the post-processing to TypeScript,
   or a helper the user runs locally. A scan gives a draft to correct.
   Port done 2026-11-13 (scoredit 7697764): `readScanScore` in src/formats/scan/, oemer's
   pipeline in TypeScript on onnxruntime-web (lazy), notes identical to Python oemer given
   the same network output; pitch 63 to 100% on 7 scan-like pages, rhythm lower (a draft).
   Speed: about 2 min a page with WebGPU on this laptop, 31 min single-thread wasm.
   Licence: oemer's staff network (unet_big, 71 MB) was trained on CVC-MUSCIMA, CC BY-NC-SA
   "non-commercial research only": not shippable. Decided (user, 2026-11-13): replace it
   with classic staff-line detection (no ML), keep seg_net and the SVM classifiers
   (DeepScoresV2, CC BY 4.0, attribution). Done 2026-11-14: classic staff lines (scoredit
   fb07f14, 80.2% pitch / 72.1% pitch+duration over 24 staffs, better rhythm than unet_big's
   69.1%), the scan in a module worker (multi-thread ORT hangs inside a worker: 1 thread or
   WebGPU there). Models on Hugging Face hikashop-nicolas/scoredit-scan (fp32 38.4 MB, int8
   10.3 MB, classifiers 5.9 MB, model card crediting oemer and DeepScoresV2), fetched and
   cached by localml/files behind the AI consent ("sheet music reading", hosts huggingface.co
   and cdn.jsdelivr.net for the ORT engine, version from scoredit's scanEngineVersion).
   Omnitext 58ddc34: a "Read sheet music" button in the image viewer opens the result as a
   new score with a draft notice; checked live on a scan-like Für Elise page (about 2 min
   with WebGPU). Not yet: image-only PDFs (waiting for the pdfcraft work), phone timing.
9. **Release** once 1-7 are done.

Small leftovers: very long text runs off the right edge of a system (1812 Overture);
a few percussion effects play a beat off against MuseScore's export; a real-phone pass on
the floating bar and the Score row; Ctrl+K (chord symbols) is taken by some browsers.

## Formats

| Format | Ext | Read | Write |
|---|---|---|---|
| MuseScore | `.mscz` (zip), `.mscx` | own reader | in place, own writer |
| MusicXML | `.musicxml`, `.xml`, `.mxl` | native (the hub) | native |
| MIDI | `.mid`, `.midi` | quantized import | export |
| ABC | `.abc` | own reader or abcjs (MIT) | export (later) |
| Guitar Pro | `.gp`, `.gpx`, `.gp3`-`.gp5` | guitarpro-parser (Apache-2.0) | own GP7 writer (older versions save as `.gp`) |
| PDF / SVG | | | export (print path) |
| LilyPond, MEI | | later, if asked | |
| Finale / Sibelius / Dorico | closed binary | no | no |

`.xml` keeps opening in the code editor; MusicXML is detected by its root element
(`score-partwise` / `score-timewise`) and offered as an alternative view.

## Libraries (npm, checked 2026-11-10)

| Need | Lib | Licence | State |
|---|---|---|---|
| Engraving | **opensheetmusicdisplay** 2.3.0 | BSD-3 | Active. Pulls VexFlow 1.2.93 (MIT, old) + jszip. Renders tab staves from MusicXML too. Display + cursor only; editing is ours. |
| Guitar Pro | **guitarpro-parser** 2.0.0 | Apache-2.0 | Reads GP3-5, GPX (GP6), GP (GP7/8), one typed model, playback timeline incl. repeats. fflate only. Young (Feb 2026), single maintainer: vendor-pin and keep our own tests. |
| Guitar Pro, fallback | slundi/guitarpro (Rust, `scorelib`) | MIT | GP3-5 stable read+write, GP6/7 experimental. Only if the TS parser dies. |
| Synth | **spessasynth_lib** 4.4 | Apache-2.0 | Active SF2/SF3/DLS synth in an AudioWorklet, MIDI player. |
| Built-in synth | **webaudio-tinysynth** (g200kg) | Apache-2.0 | All 128 General MIDI instruments + drums synthesized from oscillators, no samples, 0.2 MB. Zero download, instant. Quiet since 2022 but small enough to vendor. Alternative: Tone.js (MIT) synth voices, more work per instrument. |
| Soundfont (optional) | **MuseScore_General.sf3** (S. Christian Collins) | MIT (licence file checked) | 40 MB sf3 (osuosl mirror); downloaded on demand with a size/host dialog, never in the APK. A piano-only pack (a few MB) to evaluate as a middle tier. |
| MIDI file | @tonejs/midi | MIT | Parse/write. |
| ABC | abcjs | MIT | Only if writing our own ABC reader is not worth it. |
| Zip | fflate | MIT | Already used across the family. |

Rejected: javascriptmusic / WebAssembly Music (GPL-3, a live-coding environment rather than a MIDI player), webmscore (GPL-3, MS3 core cannot read MS4 files, unmaintained, unbuildable
for F-Droid, no editing), MuseScore itself (GPL-3 desktop app), alphaTab (MPL-2.0 +
mandatory "alphaTab.net" mark on every rendered score), Verovio (LGPL, extra wasm build).

## Architecture

```
scoredit (MIT)
  model/     ScoreDoc: a MusicXML DOM is the source of truth, plus an index
             (parts > measures > staves > voices > events) for editing, hit-testing
             and playback. Unknown elements are kept untouched.
  formats/   mscx <-> ScoreDoc (with a per-element link back to the mscx node so
             write-back only rewrites what changed), mxl, MIDI, ABC, Guitar Pro
  render/    OSMD over the MusicXML; our own overlay for selection, caret, drag
             handles and the playback cursor, mapped from OSMD's graphic model
  edit/      commands with undo/redo (see Editing); every command is a small
             transaction on the model, then a partial re-render where OSMD allows
  input/     keyboard map (desktop), touch palette + on-screen piano/fret (phone),
             MIDI keyboard via Web MIDI (desktop, where available)
  play/      ScoreDoc -> timed note events (repeats, voltas, D.C./D.S. unrolled) ->
             built-in synth or spessasynth with a soundfont; tempo, loop a selection,
             mute/solo per part, metronome, count-in
  views/     score + highlighted playing notes (auto-scroll); piano keyboard strip with
             lit keys (88 keys, zoomed to the score's range); falling-notes game view
             (canvas, notes fall onto the keyboard, colour per hand = per staff for
             piano, per part otherwise; speed, wait-for-me mode with Web MIDI later)
  ui/        toolbar/palette, bottom bar, export dialog, i18n (8 languages like
             imageview)
```

### MuseScore write-back, the richdoc way

- Unzip the mscz, parse the `.mscx`, keep everything else in the zip byte for byte
  (thumbnail, images, MS4 `audiosettings.json`, `viewsettings.json`, `score_style.mss`).
- Each model element remembers its mscx node. An edit marks the touched measures
  dirty; save regenerates only those measures' mscx and splices them back.
- Things we do not understand (custom layout, plugins' data, styles) pass through.
- Saved files must reopen in MuseScore 4 without a "corrupted file" warning: the
  corpus test re-zips with the same entry order and compression MuseScore uses, and a
  manual check in MuseScore 4 closes each phase.
- **Clean room:** the mscx format has no spec. We learn it from sample files and from
  MuseScore's own MusicXML export of the same score, **never from MuseScore's GPL
  source** (same rule as mlang).

### Editing (MuseScore-like note entry)

- **Select**: click/tap a note, rest, measure or range; arrow keys move.
- **Note input mode**: choose a duration, then enter pitches. Desktop: letters A-G,
  number keys for durations (MuseScore's own layout, muscle memory for its users),
  up/down = semitone, Ctrl+up/down = octave, `.` dot, `+` tie, `0` rest, Shift+letter
  adds to chord. Phone: a bottom palette (durations, accidentals, rest, dot, tie,
  undo) plus a one-octave on-screen piano strip that scrolls, or a fretboard for tab
  parts; tap the staff to place at that pitch with a drag-to-adjust magnifier.
- **Also**: delete, copy/paste, voices 1-4, tuplets, accidentals, articulations,
  dynamics, slurs/hairpins (phase 2 of editing), lyrics, chord symbols, text, tempo,
  key/time/clef changes, add/remove measures, add/remove instruments, transpose.
- Measures re-fill with rests automatically, as in MuseScore (no "too many beats").
- **Create**: new-score dialog (title, composer, instruments, key, time, tempo,
  pickup, measures).

### Editing design (draft 2026-11-11, for review)

**What phase 4 covers**: select, enter and change notes, rests, durations, dots, ties,
accidentals, chords, voices 1-4, triplets, delete, copy/paste, undo/redo, on phone and
desktop; save as MusicXML/mxl. Slurs, dynamics, lyrics, text and instruments wait for
phase 6; saving back into .mscz is phase 5.

**Model edits.** The MusicXML DOM stays the source of truth. Edits go through one layer
that reads a measure's voice as a list of events (rest or chord, with duration, dots,
tuplet, ties, and the `<note>` elements behind it), changes the list, and writes that
voice back into the measure. Directions and other elements stay anchored at their beat.
After every edit the voice is re-filled with rests to the bar's length, as MuseScore
does: no "too many beats" state ever exists.

- Entering a note **overwrites** what stands at the caret for its duration (MuseScore's
  default mode), splitting longer notes with ties where needed; insert mode below.
- **Undo**: each command keeps a copy of the measures it touched and puts them back.
  Simple, exact, and cheap since a command touches one or two measures.
- After an edit: the measure's width weight is recomputed, its system is rendered again
  (0.1-0.2 s on the phone, from the spike), and the systems after it are re-broken only if
  that system's measures no longer fit. The playback timeline is rebuilt lazily.

**Selection and caret.** Our own overlay on top of OSMD's drawing: a highlight on the
selected note(s) and a caret (thin vertical bar on the staff) where the next note goes.
Positions already map each drawn note to its measure and beat; this adds part, staff,
voice and pitch so a tap or click finds the exact `<note>` in the model.

**Edit mode.** Scores open for reading and playing; an **Edit** button in the bar turns
editing on, so a stray tap while reading never changes the score. In edit mode a tap
selects instead of seeking playback.

**Desktop input (MuseScore's keys, for its users' muscle memory)**: N toggles note
input; 1-9 durations (4 = eighth, 5 = quarter, 6 = half, 7 = whole); A-G enter a pitch
(nearest octave to the previous note); Shift+A-G add to the chord; up/down a semitone,
Ctrl+up/down an octave; `.` dot, `+` tie, `0` rest; Delete; Ctrl+Z / Ctrl+Y; arrows
move; Ctrl+C / Ctrl+V; Ctrl+Alt+1-4 voices; Ctrl+3 triplet. A MIDI keyboard (Web MIDI)
enters pitches where the browser has it.

**Phone input.** Edit mode swaps the bottom bar for a palette in two rows:

- Row 1: durations (16th, eighth, quarter, half, whole, more...), dot, rest, tie.
- Row 2: sharp, flat, natural, voice, delete, undo, redo, done.
- Above the palette, a **pitch strip**: the keyboard strip (one octave and a half,
  swipe to move along) for most parts, the fretboard for fretted parts, a drum-line
  picker for drum staves. Tapping it enters the note at the caret and moves on.
- Or **tap the staff** where the note goes: while the finger is down a magnifier shows
  the line or space it points at, with the note name; drag up/down to adjust, lift to
  place. Taps on a phone are too coarse to hit a line exactly, hence the magnifier.
- Tap an existing note to select it; then the palette changes it (duration, accidental,
  delete) and the pitch strip replaces its pitch.

**Save.** Phase 4 saves MusicXML/mxl through the DOM serializer. Omnitext marks the
document dirty and keeps its usual save flow; a .mscz/.mscx file stays read-only until
phase 5 (editing it would have nowhere to go), which is fine since both ship together.

**Decided (2026-11-11)**: an Edit button (scores open read-only); on the phone both the
pitch strip and tap-on-staff with magnifier; overwrite **and insert** modes; MuseScore's
keys on desktop.

**Insert mode.** A note entered in insert mode pushes what follows in its voice to the
right. The push eats rests at the end of a measure first, so it usually stops within the
bar; what overflows moves into the next bar (tied across the barline where a note is
cut) and so on, adding bars at the end of the score if needed. Other voices and parts do
not move. Toggled from the palette (phone) or Ctrl+Shift+letter as in MuseScore, with a
mode switch on desktop too.

### Editing breadth (phase 6, draft 2026-11-12, for review)

MuseScore 2 write-back is set aside (decided 2026-11-12): those files stay read-only, and
saving them once in MuseScore 4 makes them editable.

Phase 6 in steps, each shippable on its own, in this order:

1. **Dynamics, hairpins, text, tempo, rehearsal marks.** A fourth palette row, **Text**,
   beside Marks: a Dynamics button opens a grid (ppp to fff, mp, mf, sf, sfz, sfp, fp,
   rfz); `<` and `>` draw a hairpin over the selection (or from the selected note to the
   next); Staff text, Expression, Tempo (text plus beats per minute, which playback uses)
   and Rehearsal mark open the same inline field as lyrics. Desktop: Ctrl+M for a
   dynamic, `<` / `>` for hairpins, Ctrl+T text, Alt+T tempo (MuseScore's keys where it
   has them). They sit at the selected note's beat as MusicXML `<direction>`s. Deleting:
   select the note and press Delete with the Text row open, or tap the mark itself if
   OSMD's drawing lets us hit it. MuseScore save: today the writer copies these from the
   file by position; it learns to write them from the score, reusing the file's element
   when unchanged (as it does for articulations).
2. **Transpose.** Whole score or selection, by interval or to a key, keys changed with
   it; a concert-pitch toggle for transposing instruments.
3. **Key, time and clef changes** from the selected bar onwards. A key change keeps the
   pitches and respells; a clef change only moves the drawing. A time change re-bars the
   music up to the next time signature, as MuseScore does (notes cut at the new barlines
   are tied), reusing insert mode's overflow.
4. **Measures.** Insert before or after the selection, append N, delete the selected
   bars (all parts at once, as MuseScore does).
5. **Chord symbols** (`<harmony>`), entered as text and checked against a parser.
6. **New score dialog**: title, composer, instruments, key, time, tempo, pickup,
   measures.
7. **Instruments**: add, remove, change (name, sound, transposition). Last because the
   MuseScore writer would then also write part definitions, not only measures.

**Decided (2026-11-12).**
- Time changes re-bar the following music up to the next time signature, as MuseScore
  does (notes cut by a new bar line are tied). Refused, naming the bar, when a repeat bar
  line, volta or section break would no longer fall on a bar line.
- New scores are saved as .mscz, built from a blank MuseScore 4 file kept in the repo
  (made by converting our own MusicXML with MuseScore). Done together with the
  instruments step (7), since both need the writer to create MuseScore instrument
  definitions (Part, Staff, Instrument).
- New score and instruments (steps 6 and 7 together): a dialog with title, composer,
  instruments, key, time, tempo, pickup and bars, written as a .mscz from scratch.
  MuseScore 4 accepts a minimal instrument (its instrumentId, names, clef, transposition,
  MIDI program) and fills in the rest itself, and keeps it minimal when it saves again
  (checked 2026-11-12), so scoredit keeps its own small table of about 50 instruments
  (facts only: id, names, program, clefs, staves, transposition, family), never MuseScore's
  instrument data. Adding an instrument appends it with empty bars (no part file is made;
  MuseScore's Parts dialog does that); removing one also removes its part file; changing
  one keeps the sounding pitches and respells. Reordering and changing staff counts later.
- Done so far: steps 1 (dynamics, hairpins, text, tempo), 2 (transpose), 3 (key, clef,
  time: re-barring, refused across repeats and tuplets), 4 (bars), plus a bar floating over the selected notes (as
  pdfcraft's selection bar) for what changes them. Saves now reach MuseScore's
  instrument parts too (Excerpts in 4, nested scores in 3).

## Spike results (2026-11-10, OSMD 2.3.0)

Throwaway page in the session scratchpad; phone = the Android test phone in Chrome.

| | Desktop | Phone |
|---|---|---|
| Songs, 17-74 measures, open (parse + render) | 0.3-2.5 s | 0.2-1.7 s |
| Für Elise, 106 measures, open | 1.6 s | 0.7 s |
| Beethoven Op. 127, 4 parts, 1150 measures, open | 5.8 s | 15.5 s |
| Tap to note (OSMD `GetNearestNote`) | 3-22 ms, correct note | |
| One pitch edit, whole score re-laid out: Für Elise | 0.3 s | 0.6 s |
| Same, Op. 127 | 5.0 s | **11.8 s** |
| `drawFromMeasureNumber` window (still lays out the whole sheet) | 1.6-2.0 s | |
| Edit on a 16-measure **slice** rendered as its own score: Für Elise / Op. 127 | | 0.12 / 0.20 s |
| Same, 8-measure slice of Op. 127 | | 0.13 s |

**Verdict: go with OSMD, but not as one big render.** OSMD lays out the whole sheet on
every change, so edit latency grows with the score. Rendered per slice, an edit costs
the slice only (0.1-0.2 s on the phone) whatever the score length. So:

- **scoredit owns the layout above the measure**: it breaks the score into systems
  (lines), and each system is its own OSMD render of a MusicXML slice built from the
  model (clef/key/time carried in, which is what a new system shows anyway).
- **Virtualized**: only systems near the viewport are rendered; a 1150-measure
  quartet opens as fast as a song.
- **Edit = re-render one system** (or two when a measure moves across a break);
  the new note is drawn at once in our overlay, the engraved system replaces it
  ~0.15 s later.
- To check in phase 1: ties/slurs/hairpins/voltas crossing a system boundary, equal
  system widths (justification), page view built from systems, and printing.

## Phases (each ends with a shippable state)

0. **Spike (2-3 days).** OSMD on the phone with 20 corpus files, time a big score and
   a re-render after one edit. Map OSMD's graphic notes back to model notes (hit
   testing). Inventory mscx tags across MS3/MS4 corpus files. Go/no-go on OSMD.
1. **scoredit repo + viewer.** MusicXML/mxl, zoom, page/scroll, the Omnitext bottom
   bar, fullscreen and view switcher. Omnitext editor `score`.
2. **MuseScore read.** mscx -> model for the core notation; unsupported elements are
   listed in an info panel, not silently dropped.
3. **Playback.** Built-in synth, note highlighting, tempo, loop, mute/solo; piano
   keyboard view; falling-notes view; optional soundfont download.
4. **Editing core.** Selection, note input (desktop keyboard + phone palette),
   undo, save MusicXML. Export dialog.
5. **MuseScore write-back.** In-place mscz save; verified in MuseScore 4.
6. **Editing breadth.** Slurs, hairpins, lyrics, chords, text, instruments,
   transpose. New-score dialog.
7. **More formats.** Guitar Pro read + GP7 write (tab staff), MIDI import
   (quantized), ABC.
   Ship the first Omnitext release with scores only once phases 1-7 are done.
8. Collaboration binding (per COLLABORATION_PLAN.md), later.

## Test corpus (all openly licensed, fetched by a script, not committed if large)

- **OpenScore Lieder** and **OpenScore String Quartets** (GitHub, CC0): hundreds of
  MuseScore files with known-good MusicXML conversions. The MuseScore backbone.
- **OSMD's own test data** (BSD-3): MusicXML edge cases it already renders.
- **Unofficial MusicXML test suite** (LilyPond, small, check licence): one feature
  per file.
- **musescore.com** (user's logged-in Chrome): a downloaded file keeps the version
  its uploader saved it in (Für Elise, 2026-11-10: MuseScore 3.6.0, 212 measures,
  ~60 distinct mscx tags). Most uploads are someone's arrangement: local only,
  never committed.
- **MuseScore 4 files**: MuseScore 4.7 installed on the Mac (Homebrew cask) converts
  OpenScore and musescore.com files to MS4 mscz and to MusicXML on the command line
  (`mscore -o out.mscz in.mscx`), and is the "does it reopen cleanly" check for our
  write-back. MuseScore's own `vtest` files are GPL: local only, never committed.
- **Guitar Pro**: guitarpro-parser's fixtures (Apache-2.0) + public domain tabs.
- **MIDI / ABC**: The Session (ABC, check terms), public domain MIDI.
- Each file gets a golden MusicXML; tests compare model -> MusicXML and round trips
  (mscx -> model -> mscx must be byte-identical when nothing was edited).

## Risks

- **OSMD is a renderer, not an editor**: hit-testing and partial re-layout are the
  make-or-break items, checked in the spike before anything else.
- **mscx coverage** across MS3 and MS4 versions; layout from MuseScore will not
  match pixel for pixel.
- **Phone note entry** is a UX design job; prototype it early and test on the phone.
- **Built-in synth quality**: oscillators sound like a toy piano at best; the soundfont
  (40 MB) is what makes it sound like an instrument, so the download offer must be easy
  to find.
- **guitarpro-parser** bus factor of one.
- Scope: this is the largest single feature since the PDF editor, held back until
  editing works, so Omnitext releases in between carry other work only.
