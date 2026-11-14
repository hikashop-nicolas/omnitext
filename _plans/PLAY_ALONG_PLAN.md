# Playing along: MIDI instruments and practice modes in scoredit

Draft 2026-11-13, reviewed the same day. Research notes first, then the proposal.

## Decisions (user, 2026-11-13)

- Wait mode ignores extra wrong keys: it moves on once every expected pitch is held.
- No kept results or progress tracking: this is a practice aid, not a game.
- After wait mode, MIDI step entry in the editor comes next; in-time scoring after that.

## Phone test (2026-11-13, moto g85, Android 16, WebView 140)

- Capacitor's WebView has Web MIDI: `navigator.requestMIDIAccess` exists, the permission
  reads "granted" without a prompt, and access resolves at once. Android's MIDI service
  shows the app as a client: the WebView uses android.media.midi, so no native plugin is
  needed for USB devices.
- No keyboard at hand: a 9 KB test app published a virtual MIDI device (MidiDeviceService,
  driven by `adb shell am broadcast`; source kept in the session scratchpad, rebuild with
  Omnitext's Gradle setup). The WebView saw it arrive (statechange, port opened) and got
  every note and chord with their MIDI timestamps intact (an arpeggio at 0/250/500/750 ms).
- Quirk: each device is listed twice as an input and every message arrives twice. The
  input code must merge ports of one device (same name/manufacturer) or drop exact
  duplicates.
- Not tested: a real USB keyboard (cable, OTG), Bluetooth MIDI (probably needs pairing by
  Android or another app first; WebView does not scan).

## Research

### Connecting an instrument

- **Web MIDI** (`navigator.requestMIDIAccess`): Chrome and Edge on desktop, Chrome on Android,
  Firefox (recent, behind a site permission). Not Safari, not iOS. Since Chrome 124 every
  use asks for permission (not only SysEx), and it needs a secure context. MDN's table lists
  Android WebView since 43, but nothing confirms Capacitor's WebView grants it in practice:
  to test on the phone first.
- **Android native MIDI** (`android.media.midi`, API 23+): USB and Bluetooth LE MIDI devices
  through the system's MidiManager. A small Capacitor plugin of our own would be the
  dependable path in the app if the WebView does not expose Web MIDI (keyboards over USB-C
  OTG and BLE MIDI are the two common cases).
- **Output**: the same APIs send notes, so playback can drive a digital piano or a synth
  instead of (or with) the built-in sounds.
- **Acoustic instruments, no MIDI**: the microphone. Monophonic pitch (voice, winds,
  strings) is reliable and cheap in real time with YIN/McLeod-style detectors (permissive
  JS implementations exist, e.g. pitchy, MIT). Polyphonic (piano, guitar) needs a model:
  Spotify's Basic Pitch (Apache-2.0, about 17k parameters, ONNX and TypeScript ports) is
  small but built for files, its real-time latency in a browser is unmeasured. Practice
  apps that use the microphone (flowkey, Simply Piano, Yousician) are reported as less
  reliable than MIDI for "did you play it".

### How practice apps behave (Synthesia, flowkey, Symphonium, MuseScore users' requests)

- **Wait mode**: playback stops at each next note or chord until the right keys are down
  (Synthesia's Melody Practice, flowkey, Symphonium). The most asked-for feature on
  MuseScore's forum for learning with a keyboard.
- **Play along in time**: the music runs at the chosen speed; each note is marked hit, early,
  late, wrong or missed; a score (percentage) at the end.
- Hands separately (the other hand played by the app), loop a passage, slow tempo, count-in,
  metronome: practice basics.
- Falling notes plus keyboard is the usual picture for MIDI (Synthesia), a scrolling score
  for reading practice (flowkey).

### What scoredit already has

Falling-notes layout with keyboard ("keys"), page and line views with a playback cursor, a
speed control, parts shown/hidden and "my parts" from the instrument in Settings, recorded
instrument sounds, a timeline of every note (onset, length, pitch, part, staff, measure).

## Proposal

### 1. Input (scoredit, host-agnostic)

scoredit takes a `MidiInput` from the host: `{ onNote(cb: (pitch, velocity, on, time) => void) }`
plus an optional `MidiOutput { send(bytes, time) }`. Omnitext supplies it from Web MIDI, or
from a Capacitor plugin on Android if Web MIDI is not there. scoredit never asks for device
access itself (as with sounds: the host decides). A device picker and the permission prompt
live in Omnitext.

### 2. Practice modes (scoredit)

- **Wait**: the cursor (page/line) or the falling notes stop before the next onset of the
  practised part(s) until every pitch of that onset is held (any order, within one onset;
  extra wrong keys are ignored). Other parts wait too (accompaniment
  continues only in "in time" mode).
- **In time**: playback runs; each expected note is matched to an incoming note of the same
  pitch within a window (e.g. 120 ms at speed 1, scaled with the speed); hits green, early or
  late amber, wrong red, missed grey; a short summary at the end of the run, not kept.
- **Practised part**: the part(s) chosen with "my parts", or a staff (right hand / left
  hand) for piano; the rest is played by the app (or muted, a toggle).
- **Loop**: select measures (the selection the editor already has) and repeat them, with an
  optional slow-down that speeds up after clean passes.
- **Count-in and metronome**: one bar of clicks before, clicks on beats during (optional).
- Keyboard highlight: expected keys outlined, pressed keys filled (green right, red wrong).

### 3. Timing

Compare in the audio clock: incoming MIDI timestamps (Web MIDI gives DOMHighResTimeStamp)
mapped to AudioContext time, minus the output latency (AudioContext.outputLatency, plus a
user calibration step: tap along with clicks, stored in Settings).

### 4. MIDI output and step entry (smaller, later)

- Send playback to the connected instrument (choice: built-in sound, instrument, both).
- In edit mode, a MIDI keyboard enters pitches (MuseScore-style note input: the selected
  duration, the pitch from the key, chords from keys held together).

### 5. Microphone (later, separate step)

- Monophonic first: a pitch detector on the microphone feeds the same matcher (wait and in
  time) for voice and melody instruments.
- Polyphonic later, if a model proves fast enough on phones (measure Basic Pitch in a
  worklet/worker with onnxruntime-web first).

## Steps

1. Phone test: done (Web MIDI works in the app's WebView, see above); a real USB and a BLE
   keyboard remain to try when one is at hand.
2. scoredit: MidiInput/MidiOutput types; the note matcher (pure, unit tested on timelines
   and recorded note streams); wait mode in keys and page views.
   Done 2026-11-14 (scoredit 6b24022, Omnitext ebb3bcb): webMidiInput merges ports and drops
   twin-port duplicates within 2 ms; WaitMatcher (a group counts once each pitch is struck
   since it became current, any order, wrong keys ignored, a held key must be re-struck; ties
   expect their first note, graces never, ornaments their written note, tremolos their first
   stroke); practised parts are the parts shown, right/left hand by staff for piano; the
   other parts play up to the gate and wait; keys and keyboard strip show expected (outline)
   and played (green or red); "Hear my notes" echoes keys on the built-in synth. Omnitext
   connects MIDI at once where access is granted (the app), else from the palette (Connect a
   MIDI keyboard). e2e with a fake input. Phone, 2026-11-14 (virtual keyboard app): MIDI
   connected by itself, Practice shown; with "Wait for me" the cursor held on C4, ignored a
   wrong C#4, moved on for C4, D4... B4, and playback ended at the last bar.
3. Omnitext: device picker, permission flow, Settings (latency calibration).
4. Step entry from a MIDI keyboard in the editor.
5. In-time mode with feedback; hands separately; loop with speed-up.
6. MIDI output.
7. Microphone, monophonic.
