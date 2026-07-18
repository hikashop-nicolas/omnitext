# richdoc on-device writing assist (omnitext issue #17)

Add **translate / elaborate / shorten / write** to the richdoc editor (.docx/.odt), all
on-device via [[localml]]. Best-of-breed models (owner's call). Same privacy story as the
rest of localml: no server, models fetched from the HF CDN once and cached.

## Task -> model mapping

| Task | Engine | Model | Notes |
|---|---|---|---|
| translate | existing `localml/translate` | m2m100 / NLLB | already shipped, reuse as-is |
| summarize | `summarization` pipeline | `Xenova/distilbart-cnn-6-6` (~150 MB q8) | purpose-built abstractive summarizer; general shared task |
| elaborate | chat / `text-generation` | `onnx-community/Qwen2.5-0.5B-Instruct` (~0.5 GB) | prompt: expand while keeping meaning/tone/language |
| shorten | chat | same instruct LM | prompt: rewrite more concisely (a concise *rewrite*, not a news summary, which is why it's the instruct LM not distilbart) |
| write | chat | same instruct LM | user gives an instruction; output inserted at the caret |

Qwen2.5-0.5B-Instruct chosen for the instruct LM: multilingual (owner works FR/JA),
small, ONNX for transformers.js. Alternates if it underperforms: SmolLM2-360M-Instruct,
Llama-3.2-1B-Instruct. WebGPU strongly preferred for the causal LM (token-by-token);
WASM is the slow fallback. Summarize tolerates WASM (short output).

## Phase 1 - localml `./generate` export  [DONE 2026-07-18, localml 83b2f15]

Shipped and browser-verified on WebGPU: summarize (distilbart) returns a real summary; the
chat tasks stream coherent text. Key tuning: q8 for the chat model on both backends, q4f16
collapsed the 0.5B model into repeated-token gibberish (same 4-bit failure the translator
hit). 0.5B output is a rough first draft (over-runs length requests), so the preview-Accept
UX in Phase 2 matters. Details below were the build spec.


Mirror the translate slice (driver + lazy worker + catalog + worker-common reuse):
- `src/gen-backend.ts` - `GenModelInfo` catalog (`GEN_MODELS`), `TASK_MODEL` default per task,
  `genModel(id)`, and pure `buildMessages(task, input)` / prompt + `capFor()` token sizing.
  Unit-tested (`gen-backend.test.ts`), like `backend.test.ts`.
- `src/generate.worker.ts` - two engines off the main thread:
  - summarize: `pipeline("summarization", model)`.
  - chat: `pipeline("text-generation", model)` with the chat template + task prompt.
  Both stream via `TextStreamer` (callback posts partial text), WebGPU with a WASM fallback
  (reuse `hasWebGpu` + the try/catch + device-loss retry pattern from translate), anti-ramble
  caps (`max_new_tokens`, `repetition_penalty`, `no_repeat_ngram_size`).
- `src/generate.ts` - `runGenerate(input, {task, model?, device?}, cb)` returning
  `{ cancel(), done: Promise<{text, stopped}> }`, streaming cumulative text via `onPartial`,
  `onProgress` (download %), `onDevice`. Re-exports the catalog.
- `package.json` `exports["./generate"]`.
- Demo: task picker + input + streamed output in `demo/`.
- Verify: unit tests green; demo runs summarize + elaborate + write (smallest model first;
  model download is heavy, so real-inference verification is best-effort in the automation
  browser and otherwise done on the owner's machine).

## Phase 2 - richdoc `feature/assist`  [DONE 2026-07-18, richdoc 62bdc0d]

Shipped as designed and browser-verified in richdoc's demo (WebGPU): toolbar control localizes,
menu items gate on a selection, Translate downloaded m2m100 through richdoc's bundle, streamed a
translation, and Accept replaced the selected paragraph + marked the doc edited. Spec below.


- `richdoc` gains `localml` as a dependency, LAZY-imported inside the feature (dynamic
  `import("localml/generate")` / `import("localml/translate")`) so the base editor bundle is
  unaffected until the user invokes an assist action. Gated by `EditorOptions.assist` (default
  on; opt-out for hosts that don't want it).
- `src/core/feature/assist.ts`: a toolbar control (sparkle icon) opening a menu -
  Translate / Elaborate / Shorten / Write.
  - Translate / Elaborate / Shorten act on the current selection; Write asks for an
    instruction and inserts at the caret.
  - Translate needs a target-language pick (reuse `TRANSLATE_LANGS`).
  - UX: a preview popover streams the result with a model-download progress line, then
    Accept (replace selection / insert) / Retry / Cancel. Preview-before-apply because
    small-model output is rough; Accept goes through the normal edit path so undo/track-
    changes handle it.
- i18n keys in richdoc's locales (en/fr/ja...).

## Phase 3 - Omnitext  [DONE 2026-07-18]

richdoc bumped (62bdc0d); localml pinned directly at 83b2f15 (the ./generate commit, a superset
still shipping ocr + translate) so it dedupes to one copy for richdoc + subedit + imageview.
Verified: the Assist control mounts in the docx editor and the lazy localml import resolves
through Omnitext's own bundle. Issue #17 done.


- Bump the richdoc pin; ensure `localml` resolves for richdoc (it's richdoc's dep, and
  Omnitext already depends on localml, so the worker-url trick + Vite bundling apply as they
  do for subedit). Verify assist on a real .docx/.odt in Omnitext.

## Future (owner "also thinking", not this pass)

- sheetedit: "help build a formula" (natural-language -> a formula, chat engine with a
  spreadsheet-formula system prompt).
- subedit: per-line translate (already has localml/translate) + "help with ASS" (explain/fix
  ASS override tags via the chat engine).
Keeping the localml `./generate` API generic (task + input + streamed text) so these consumers
drop in later without new engine work.

## Risks / honesty

- Quality: 0.5B on-device is a rough first-draft assistant, far below server LLMs. The
  preview-Accept UX and "these run on your device" framing set expectations.
- Size/first-run latency: ~0.5-0.7 GB download for the instruct LM (cached after). Show the
  download progress; consider a one-time confirm before the first big fetch.
- WebGPU divide: causal generation is only pleasant on WebGPU; WASM users get a slow path.
