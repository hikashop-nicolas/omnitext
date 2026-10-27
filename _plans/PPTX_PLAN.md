# PPTX editor on DeckCraft's engine (spike result and plan)

Status: spike done 2026-10-28, nothing wired into Omnitext. Target: 2.1, not 2.0.

## What was measured

DeckCraft (github.com/storytold/deckcraft, MIT OR Apache-2.0, ArtCraft family, "early development") is built like
PdfCraft: pptx, model, render and engine crates, and every action is a JSON command
(`Session::execute(id, params)`, 330 commands: file.openBytes, file.saveBytes, file.render, slide.*, shape.*, insert.*).
A throwaway wasm crate (~/dev/deckcraft-spike, not in git) tried two shapes on three real decks (8, 28 and 81 slides,
one 7 MB of photos):

| Shape | wasm | gzip | What it gives |
|---|---|---|---|
| pptx + render + model only | 6.3 MB | 2.4 MB | open, render any slide, save as pptx |
| plus the engine | 17.6 MB | 6.5 MB | the 330 commands: edit text, shapes, tables, charts, slides, undo |

- Rendering is faithful on real decks: photos, charts (pie with Japanese labels), custom fonts where embedded or
  available. Opening takes 50 to 300 ms; a text slide renders in 80 to 100 ms, a photo-heavy one in 0.5 to 3 s at 1x.
- Save round trip works: 81 slides reopen with 81; the 7 MB deck saves at 7.07 MB.
- Edit works through the engine: `insert.textBox` then `file.render` showed the new text; `file.saveBytes` gave a pptx
  that reopens.
- Gap: CJK in a new text box rendered as tofu in the engine path. The engine needs a fallback font set (the same
  craft-fonts approach as PdfCraft: BIZ UDPGothic, our Hans subset, NanumGothic).

## Video: reuse mediaplay

The engine links DeckCraft's own decoders (H.264, HEVC, VP9, AV1, Opus, symphonia, about 47k lines) through the
`deckcraft-media` crate, but uses them in nine places only: probing a file (4), reading headers, a poster frame from a
video, and media info. Omnitext does not need any of it:
- playing an embedded video or audio: take the file out of the pptx zip and hand it to mediaplay (already our player);
- the poster frame: the browser draws one from a `<video>`;
- probing: duration and size come from the element too.
So the plan is a `decode` feature on deckcraft-media (default on, off in our build) that leaves `probe` and drops the
decoders; it is a carry patch first, an upstream PR after. Expected saving: several MB of the 17.6.

## Plan (2.1)

1. deckbridge, a public MIT repo like craftbridge: wasm facade (open, commands, render to RGBA, save), a worker, a
   typed client, tests on the real wasm.
2. Our own UI, in the app's style and touch-first: slide strip, canvas with selection handles, a floating bar for the
   selected shape, text editing, insert menu, undo.
3. Fonts: the craft-fonts fallback set, as for PDF.
4. Replace the read-only pptx viewer (third-party renderer) once the editor is as good for viewing; keep a view-only mode.
5. Same F-Droid rule as the PDF engine: built from source in the recipe.

Risks: the project is young and its commit rate is very high (same as PdfCraft), so the weekly upstream check
(craftbridge `scripts/sync-upstream.sh`, to be generalised) matters from day one; wasm size and first-render time on
phones are unmeasured.
