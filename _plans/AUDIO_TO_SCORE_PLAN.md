# Audio to score: transcribe a recording into an editable score

Draft for review (2026-11-15). Spike done for a solo piano recording; nothing built yet.
Open points for the user are at the end.

## Goal

Open an MP3 (or any audio Omnitext plays) and get a score in the score editor, the way a
photo or a PDF of a score becomes one today. First a single instrument (piano, guitar, a
voice), then songs with several instruments and a singer, one staff per part.

As with the scan import, the work lives in **scoredit** (MIT), so Omnitext only adds the
button, the downloads and the progress.

## What the spike showed (2026-11-15)

Public-domain recording of Für Elise (Wikimedia Commons, piano, 2:55), local only.

- **Notes**: Spotify's Basic Pitch got the pitches right. The opening reads E D# E D# E
  B D C A with the left-hand A E A and E G# E figures. Errors: a few ghost notes an octave
  off, duplicates, and two stray notes before the music starts. 1199 notes found.
- **Rhythm without beats**: fed straight to scoredit's MIDI reader (`midiToMusicXml`),
  the result was unreadable: 4/4 at 120, quintuplets everywhere. That reader expects a
  file recorded to a click, with beats on whole quarters.
- **Rhythm with beats**: beats found in the audio (librosa, spike only), each snapped to
  the nearest strong onset, notes warped so beat k lands on quarter k and snapped to
  half-beats. The score becomes readable: no stray tuplets, melody and left hand
  recognisable. Still wrong: values doubled (3/4 instead of 3/8, the beat found was the
  eighth), the pickup misplaced, extra voices and rests from ghost notes, some notes on
  the wrong staff.
- **Time**: about 40 s on the Mac in Python for 3 minutes of audio, most of it start-up.
  The model itself is tiny; the phone is not measured yet.

Scripts and outputs: session scratchpad `amt/` (warp2.py, m2x.ts, w2-*.png).

## Building blocks found (licences checked 2026-11-15)

Permissive licences only, as everywhere in Omnitext. "Weights" means the trained model
file, which needs its own licence, separate from the code.

| Piece | What it does | Licence | Size | Verdict |
|---|---|---|---|---|
| **Basic Pitch** (Spotify) | Audio to notes, polyphonic, any instrument | Apache-2.0, code and weights (model card) | 230 KB ONNX | **Use**. Works best on one instrument at a time, does not say which instrument plays |
| **Beat This!** (JKU Linz, ISMIR 2024) | Beats **and downbeats** (where bars start) | MIT, code and weights (README) | small 8.1 MB, final 78 MB | **Use the small model**. Solves the metre and pickup problem the spike hit. README warns some training audio was copyrighted |
| **Spleeter** (Deezer) | Separates a song into 2, 4 or 5 stems (vocals, drums, bass, piano, other) | MIT, code and models (JOSS paper) | about 20 MB per stem fp16 (ONNX ports) | **Candidate for songs**. 2019 quality, but clearly licensed and light |
| **HT-Demucs** (Meta) | Same, better quality; a 6-stem variant adds guitar and piano | Code MIT; **no licence stated for the weights**; repo archived Jan 2025 | 166 MB fp16, 316 MB fp32 | Not now: unclear weights licence, too heavy for a phone |
| BS/Mel-RoFormer (community) | State-of-the-art vocal separation | Code MIT; weights from various people, terms unclear | 100+ MB | No: provenance unclear |
| Open-Unmix UMX-L | 4 stems | Weights CC BY-NC-SA | | No: non-commercial |
| RMVPE | Sung pitch straight from a full mix | Code Apache-2.0; usable weights come from the RVC project (MIT, provenance murky) | about 180 MB | Maybe later, if Basic Pitch on a vocal stem is not enough |
| MT3 (Google) | All instruments at once, names them | Code Apache-2.0; checkpoint terms not stated | large T5 (JAX) | No: unclear weights, hard to run in a browser |
| YourMT3+ | Same, better | GPL-3.0 | | No: GPL |
| MuScriptor (Kyutai, 2026) | Best multi-instrument results reported | Weights CC BY-NC 4.0 | | No: non-commercial |
| Whisper | Lyrics with word times | MIT, already in Omnitext (transcription) | already downloaded by users of transcription | **Use** for lyrics under the vocal line |

So there is no permissively licensed model that hears a whole band and writes every
part. The workable route is **separate, then transcribe each stem**.

## Can parts be separated by frequency?

Partly, and only for some parts:

- **Drums: yes, mostly.** Kick, snare and hi-hat live in different bands (low thump,
  mid crack, high hiss). Onsets per band give a usable drum staff without any model.
  Separating percussive from pitched sound (harmonic/percussive separation, a classic
  median-filter method from 2010, no model needed) also cleans the input for Basic Pitch.
- **Bass line: roughly.** The lowest notes Basic Pitch finds are usually the bass. A
  register rule (below about E3) makes a fair bass staff.
- **Voice, guitar, piano, strings: no.** Their ranges overlap (a voice spans C3 to C6,
  right where guitar and piano play), and each note carries harmonics far above its
  pitch, so a band filter cuts every instrument in pieces. What tells them apart is
  timbre, which is what separation models learn.

So frequency splitting is worth having for drums and bass, and as a fallback when
the separation model is not downloaded. It is not a substitute for it.

## Pipeline

1. **Decode** the audio to mono 22.05 kHz (Omnitext already decodes every audio format
   it plays).
2. **Separate** (songs only, phase 4): Spleeter stems, or the frequency fallback.
3. **Notes**: Basic Pitch per stem, in a worker, in chunks with a progress bar. The note
   decoding (from the model's frame output to notes) is ported to TypeScript (Apache-2.0
   allows this, with its notice kept).
4. **Beats and bars**: Beat This! small on the full mix (the drums help). Fallback
   without the download: our own beat tracker over the onsets (a published
   dynamic-programming method), with the metre asked for.
5. **Warp and quantize**: beat k to quarter k (or eighth, from the downbeat spacing),
   then scoredit's existing beat quantizer, told that audio rarely holds quintuplets.
6. **Clean up**: drop ghost notes (quiet, short, octave doubles of a louder note), merge
   duplicates, split piano hands, pick a key from the notes.
7. **Write** MusicXML through the same path as a played-in MIDI file, one part per stem:
   voice (with lyrics, phase 3), piano, bass, other, drums.

## User experience

- **Where**: a "Transcribe to score" button in the media player when an audio file is
  open, and "From a recording" in the New score dialog.
- **One question first**: "What is playing?" Solo instrument / Voice / A song with
  several instruments. The answer picks the route and the downloads.
- **Downloads asked for once**, with sizes, as for recorded instruments: Beat This!
  (8 MB), Spleeter stems (about 80 MB for 4 stems), Whisper only for lyrics.
- **Result review**: the score opens with the suggested time signature and first bar;
  a small bar lets the user change the metre or move bar 1 and redo the last steps
  without running the models again.
- Offline after the downloads, nothing leaves the device, as for every Omnitext model.

## Phases

0. **Spike** (done for solo piano). Still to measure before committing: Basic Pitch and
   Beat This! speed on the phone, and Spleeter 4 stems on a 3-minute song on the phone
   (if that takes minutes, songs become a desktop-first feature).
1. **Solo instrument in scoredit**: note decoding port, Beat This! small, warping,
   quantizer tuning, clean-up, hand split. Test bed: corpus scores rendered to audio
   with scoredit's own sounds (exact ground truth) plus a few public-domain recordings
   (Musopen, Wikimedia Commons). Scores with the scan bed's compare tool and a note F1.
2. **Omnitext integration**: the button, the dialog, worker and progress, the downloads
   (models on the existing Hugging Face repo, as for the scan model), i18n in all 8
   languages, F-Droid notes.
3. **Voice**: melody from a sung line (Basic Pitch, RMVPE if needed), lyrics from
   Whisper word times placed under the notes.
4. **Songs**: Spleeter stems, one staff per stem, drums by frequency band, bass by
   register; the frequency-only fallback when the stems are not downloaded.
5. **Later**: chord symbols from the transcribed harmony, a better separation model if
   a clearly licensed one appears (HT-Demucs if Meta states a weights licence).

## Risks

- **Training data**: Beat This! says some of its training audio was copyrighted; the
  weights are still MIT. Same open question as every audio model; the scan model has
  the same shape of answer in the README.
- **Phone speed and memory** for separation: unknown until phase 0 measures it.
- **Expectations**: a transcription is a draft. Even commercial tools miss notes on dense
  music; the UI should say so and make fixing easy (the editor already does).

## Open points for the user

1. Start with solo instruments only (phases 1-2), and decide on songs after measuring
   Spleeter on the phone?
2. Is Spleeter's 2019 quality acceptable for songs, given that the better models are
   either unlicensed (Demucs weights) or non-commercial?
3. Lyrics under the vocal line through Whisper: in scope?
4. Entry points: media player button and New score dialog, or one of them?
