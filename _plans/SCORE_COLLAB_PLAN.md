# Scores in a shared session: editing together and playing in sync

Draft for review (2026-11-16). Nothing built. Follows up SCORE_PLAN.md item 8
("Collaboration binding, later") and uses the session of COLLABORATION_PLAN.md as it is.

## Decisions (user, 2026-11-16)

- **The host is the conductor**, always. No handing over the baton.
- **The host controls the mode for everyone.** On the other devices the play button and
  the edit button are greyed out. When the host enters edit mode, every joiner enters it
  too; when the host leaves it, they all leave it. Editing is therefore allowed by the
  host, by hand, and only while the host is in edit mode. Joiners who came in through a
  read-only link stay in view mode.
- **What a device shows stays its own choice**: the guitarist shows only the guitar part,
  the pianist only the piano, the host all parts or a few. Shown parts are never shared;
  only the score, the mode and the playback are.

## Goal

Share an open score the way a text, a sheet or subtitles are shared today, and add what
only a score needs:

1. **Edit together**: notes, bars, parts, title, each person seeing the others' carets.
2. **Follow together**: every device's cursor and page turns follow the session's
   playback, sound or not (musicians reading from tablets).
3. **Play together**: every device sounds the score at the same moment, each one able
   to show and mute its own part (a rehearsal where the app plays the other parts).

## What exists

- **The session** (src/tools/collab/): sends the base file to joiners, a Yjs document,
  a presence channel (awareness), content-addressed blobs, an `ordered` channel for edits
  that cannot merge, and raw provider channels between peers. An editor joins by
  implementing `collab()`; the score editor does not, so a score cannot be shared today
  (the session reports "unsupported").
- **scoredit's model**: the score is the MusicXML DOM itself (ScoreDoc), so unknown
  elements survive. Every edit calls `score.changing(part, measure)` before touching a
  bar (`beforeChange` hook, `dirty` set); bar inserts and deletes and part changes call
  `refresh()` / `rescanParts()`. Undo copies the bars before an edit and puts the copies
  back (whole parts for bar inserts and deletes).
- **scoredit's player** (src/play/player.ts): everything hangs on `startAt`, the audio
  time of piece time 0 at the current speed. play, pause, seek, seekMeasure, setSpeed,
  shown parts (`myParts` from Settings) and practice skip already exist.

## Part 1: editing together

### Shared shape

The unit is **one bar of one part**, as MusicXML text. Same reasoning as subtitle cues
(src/editors/subtitle-collab.ts): keyed entries, so two people on different bars, or on
different parts of one bar, never touch the same thing.

- `score.bars`: Y.Map, key `partId|barId`, value the `<measure>` element serialised.
- `score.columns`: Y.Array of bar ids, the bar order shared by every part.
- `score.parts`: Y.Array of part ids, plus `score.partInfo` (Y.Map per part: the
  `<score-part>` serialised).
- `score.head`: Y.Map for work title, movement title, creators, credits, defaults.

Bar numbers are not ids: inserting a bar would renumber everything after it. scoredit
gives each column a stable id (an internal attribute, dropped by `serialize()` like
PLAY_STRETCH), created at load and for every new bar.

### Flow

- **Seed**: the host writes the score into the empty document; joiners already have the
  same base file and read the document back, so their DOM matches the host's.
- **Local edit**: after each edit, the binding writes the bars in `dirty` whose text
  differs from the shared value, in one transaction (only what changed, as writeCues does).
- **Remote edit**: scoredit replaces the `<measure>` element, reindexes from that bar on,
  and redraws the affected systems. A remote change never enters the local undo stack.
- **Structural edits** (insert or delete bars, add, remove or reorder parts, change the
  number of staves): proposed on the `ordered` channel and applied in one order by
  everyone, as row and column inserts are in the spreadsheet (src/editors/sheet-structure.ts,
  OpSequencer). The edit waits for its turn; the bars around it stay editable.
- **Key, time and clef changes** live inside a bar's `<attributes>`, so they travel as
  bar edits; reindexing after a remote bar makes later bars read them.
- **Undo in a session**: a Y.UndoManager tracking this peer's origin only, so undo takes
  back your own edits and never someone else's. Outside a session scoredit's own undo
  stays as it is.
- **Carets**: each peer publishes part, bar, beat and staff in the presence channel;
  scoredit draws the others' carets and selections in their colours.
- **Saving**: unchanged. Every device has the same base file, so MuseScore and Guitar Pro
  files are saved by writing the edited bars back into it, as today.

### Known limit

Two people in the **same bar of the same part** at the same moment: last writer wins,
the other edit is lost. People usually split work by part or by section, so start there
and refine the unit to one voice of one staff inside a bar only if it bites. (readMeasure
and writeMeasure already split a bar into voices.)

### scoredit additions

- Stable column ids.
- `applyBar(part, barId, xml)` and `applyStructure(op)` with partial redraw.
- An edit-observer API (bars changed by the last edit, structural edit about to happen)
  so the host can publish or propose instead of reading `dirty` itself.
- Remote carets and selections.
- An option to hand undo to the host.

## Part 2: following together

The session's state, written only by the host (the conductor):

- `score.transport`: Y.Map with `playing`, `pieceTime`, `speed`, `at` (the host's clock
  time from which these hold), and a counter bumped on each change.
- `score.mode`: `view` or `edit`. Joiners follow it (read-only joiners stay in view).

Every device moves its cursor and turns its pages from that state, so the host's play,
pause, seek, bar jump and speed change reach everyone. On joiners the play and edit
buttons are greyed out with a tooltip saying the host controls them, and seeking by
tapping a bar is off. Each device keeps its own parts menu, zoom and layout; the cursor
follows the shown parts like it does today. Practice wait mode is off in a session.

Only the host writes these two maps; a joiner's binding ignores its own writes to them
and the host's binding rejects them, so a modified client cannot take the baton. Visual sync needs about 50 ms, which plain message delivery gives on a LAN; the
common clock below makes it independent of relay hops.

## Part 3: playing together

- **Common clock**: a `clock` provider channel; each peer exchanges a few timestamped
  pings with the conductor (four timestamps per exchange, keep the fastest round trips)
  and keeps an offset to the conductor's `performance.now()`. Refreshed every few
  seconds. Expected a few ms on the same wifi; to be measured.
- **Start on time**: each device turns `at` into its own audio clock (performance.now and
  AudioContext.currentTime read together, as `Player.clock()` already does) and starts
  playback so that `pieceTime` sounds at that moment. scoredit needs `playAt(pieceTime,
  audioTime)` beside `play()`, which today starts at "now + 50 ms".
- **Output delay**: AudioContext `outputLatency` where reported, plus a per-device delay
  in Settings (like the MIDI delay), with a tap-along calibration. Bluetooth speakers add
  150 to 300 ms and Android does not always report it.
- **Drift**: audio clocks drift by a few ms per minute. Each device compares its position
  with the conductor's timeline and corrects small gaps with a slight speed change, a
  seek only beyond about 80 ms.
- **Parts**: each device chooses which parts it shows and which it sounds (its own part
  muted, the others played), as the parts menu and practice skip already allow. What it
  sounds is independent of what it shows: the guitarist can show only the guitar and still
  hear the rest. Whether every device sounds or only some (one speaker in the room is
  often enough) is a per-device switch too.

## Measurements first (before Part 3)

Throwaway page on the session: two tabs on the Mac and the Android phone, same wifi.

- Clock offset accuracy and stability over 10 minutes.
- Onset gap between devices on a click track, recorded with one microphone, speaker and
  wired output, then Bluetooth.
- Drift over 5 minutes without correction.

If the onset gap stays under about 20 ms after calibration, Part 3 goes ahead as above;
otherwise sound stays on the conductor's device and the others follow visually.

## Phases

1. **Read-only share**: score editor gets `collab()`, joiners view the score with their
   own parts choice, play and edit greyed out. Small, and makes the binding real.
2. **Following together**: transport state from the host, cursor and page turns.
   Before editing, because it is smaller and is the case musicians meet first.
3. **Editing together**: `score.mode` from the host, shared bars, ordered structural
   edits, session undo, carets. Tests with two Y.Docs and no DOM, as for subtitles and
   sheets (session-pair tests).
4. **Measurements**, then **playing together**: clock channel, `playAt`, output delay
   setting and calibration, drift correction, per-device parts.
5. i18n in all 8 languages for every new string, at each phase.

## Risks

- **Bar text size**: a bar with many voices and lyrics is a few KB; fine for edits, but
  the seed of a large score is the whole file again in the document. Measure on the
  biggest corpus scores.
- **DOM equality**: peers must parse the same base into the same DOM for the seed to be
  trusted; a check of the first sync (hash of each part's bars) should catch a mismatch.
- **Redraw cost**: a remote edit must redraw only its systems, or a busy session will
  stutter on the phone.
- **Audio on Android**: WebView audio latency and suspended contexts in the background.

## Settled details (user, 2026-11-16)

- When the host leaves edit mode while a joiner is mid-edit (a note half entered), the
  joiner's pending edit is committed as it stands, then the mode switches.
- Switching mode does not touch playback: it keeps playing for everyone, and an edit
  made while it plays swaps in the new timeline (Player.setTimeline, which resumes at the
  same position), so the edit is heard when playback reaches it.

No open points left; next step is phase 1.
