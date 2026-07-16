# Image viewer: extract to own repo + OCR / translation / QR (issues #15, #16)

## The two open issues

- **#16** Add OCR / translation to the image viewer, and make the image viewer its
  own repo.
- **#15** Auto-detect QR codes in the image viewer (research a JS lib, surface the
  decoded content to the user).

Both target the same component and #16 asks to spin it out, so the sensible move is
to treat them as **one effort**: extract the viewer into a standalone repo and grow
OCR + translation + code-scanning there, then consume it back in Omnitext.

## Current state

- `src/editors/image.ts` (6 lines): lazy `EditorDescriptor`, `consumesViews:["image"]`,
  `readOnly:true`.
- `src/editors/image.impl.ts` (85 lines): a read-only `<img>` in a blob URL with
  click-to-toggle fit-vs-actual. No toolbar, no side panel.
- `src/editors/filerobot.ts` + `.impl.ts`: the heavy raster **editor**, offered as an
  alternative view (`id:"imageedit"`). Stays as-is.

There is no OCR / translation / barcode code anywhere in the family today (the
"translat" hits in the tree are i18n UI strings and CSS transforms).

## Prior art / library research (2026)

**OCR (#16) - also shared with subedit.** [Tesseract.js](https://github.com/naptha/tesseract.js/)
v7 is the standard pure-browser OCR. WASM + SIMD, 100+ languages, worker-based,
~2.1 MB (Brotli) for the lib + English data, lazy-loadable. v7 is 15-35% faster than
v6. On brand: fully client-side, no server. Clear choice.

Crucially, subedit's own `_plans/BINARY_FORMATS_PLAN.md` **already commits to
Tesseract.js in a Worker** for the image-based subtitle formats (Blu-ray PGS `.sup`,
VobSub `.sub`/`.idx`, DVB/DVD-VOB): decode the RLE bitmaps to PNG, then OCR to text.
Its lazy-load/Worker/progress design is explicitly modeled on subedit's existing
transformers.js path. So OCR is shared infra between imageview and subedit, the same
way translation is: build the OCR module **once**, and subedit's future image-sub
importer consumes it instead of reimplementing.

**Barcode / QR (#15):** progressive enhancement is the accepted pattern.
- Native [BarcodeDetector API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector):
  zero-weight, but Chromium-only (no Firefox/Safari), HTTPS-only.
- [zxing-wasm](https://www.npmjs.com/package/zxing-wasm): actively maintained WASM
  build of zxing-cpp, TS types, QR + many 1D/2D formats, works everywhere.
- Plan: try native `BarcodeDetector` first, fall back to `zxing-wasm` when the API
  is absent. Covers all browsers; only pulls the WASM on non-Chromium or on demand.
- Both return **bounding boxes** per code (`BarcodeDetector` -> `boundingBox` +
  `cornerPoints`; zxing-wasm -> corner `position`), so a click point can be hit-tested
  against detected codes. That is what drives the click-to-detect interaction below.

**Translation (#16): reuse subedit's engine.** subedit already ships a mature,
fully client-side translation core in `src/transcribe/` (`translate.ts`,
`translate.worker.ts`, `worker-common.ts`, plus the translate slice of `backend.ts`):
- transformers.js (`@huggingface/transformers`) running **m2m100-418M** (default) or
  **NLLB-200-distilled-600M**, ISO/FLORES code mapping, 12 languages wired.
- WebGPU when available, automatic WASM (CPU) fallback, GPU-loss retry, per-line
  token-cap anti-ramble tuning, streaming partials, pause/resume/stop, cached model
  download with a monotonic progress bar.
- Crucially it is **not subtitle-specific**: `runTranslate(texts: string[], opts)` in,
  translated `string[]` out. Zero coupling to cues. Only external dep is
  transformers.js.

This beats the [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
(desktop-Chromium-only, no mobile/Firefox/Safari) on every axis that matters here:
universal, on-device, already battle-tested. So **imageview translates OCR output by
reusing subedit's core**, not by adding a new engine. The one thing to decide is
*how* we share it (below).

## Proposed design

### New standalone repo: `imageview`

Match the family pattern (geoedit / subedit / mediaplay / sheetedit): MIT, public,
`github:hikashop-nicolas/imageview`, Vite lib build + `tsc` types, `demo/`, committed
`dist/`, consumed by Omnitext as a git dependency. Self-contained UI, byte-in,
read-only, no framework. **Extract directly** into this repo (no in-place interim).

Public surface (rough):

```
mountImageViewer(container: HTMLElement, opts: {
  bytes: Uint8Array; mime?: string; filename?: string;
  i18n?: Partial<Strings>;
  onExtractText?: (text: string, meta: {source: "ocr"|"translate"|"qr"}) => void;
}): { destroy(): void }
```

The `onExtractText` callback is how Omnitext turns an OCR result, a translation, or a
decoded QR payload into a **new text document** through the host API, without imageview
knowing anything about Omnitext.

**QR/barcode is a click interaction, not a toolbar button (#15).** The user clicks a
spot on the image; imageview checks whether a code sits under that point and, if so,
opens an **info card** for it.

- The existing click already toggles fit-vs-actual zoom, so detection takes
  precedence and falls through: on click, hit-test the point against detected codes;
  if it lands on one, open its info card and swallow the zoom toggle; otherwise zoom
  as today.
- To have boxes to hit-test, run **one** detection pass **lazily on the first click**
  (not on open, so nothing scans until the user interacts), cache the result, and
  hit-test every later click instantly. The pass maps `<img>` display coordinates to
  natural pixels (`naturalWidth/Height` vs the rendered rect) so the click lines up
  with the code box.
- The info card shows the decoded value + format, linkifies a URL payload (open in a
  new tab, `rel="noopener"`), a copy button, and "new document from this" via
  `onExtractText(..., {source:"qr"})`. Dismissable.
- Discoverability: once the first scan has run and codes are known, give detected code
  regions a `cursor: pointer` on hover (and a faint outline on hover only), so the
  user sees a code is clickable without a persistent badge.

Toolbar: keep the current click-to-zoom / fit-vs-actual behaviour, add a small overlay
(same restrained SVG-stroke icon style as subedit/richdoc) with **two** on-demand
actions, each opening a dismissable side/bottom panel:

1. **Extract text** (OCR, #16): language picker (default: UI language + English),
   progress bar, result in an editable textarea, copy / "new text document".
2. **Translate** (#16): reuse `localml/translate`; pick target language, translate the
   OCR text; stream partials into the panel; copy / new-doc. Model downloads on first
   use with the existing progress bar; WebGPU/WASM auto-selected.

All heavy deps (tesseract.js, zxing-wasm, transformers.js) load **only on demand**
(OCR/translate on first button press, QR detection on first click) and the translation
model downloads only on first translate, so the base viewer stays as light as it is
today.

### Omnitext integration

- Rewrite `image.impl.ts` to mount `imgview` and wire `onExtractText` to the existing
  "open a new document" path (same mechanism the other viewers use to spawn docs).
- Keep the lazy `image.ts` descriptor and the filerobot "edit" alternative untouched.
- Add i18n keys (en/fr/ja) for the new labels, **appended at the end** of each locale
  file per house style.
- Add `"imgview": "github:hikashop-nicolas/imgview"` to package.json, build, commit
  package.json + lock, push (Omnitext pushes to main are pre-authorized).

### Shared on-device ML lib: `localml` (OCR + translation)

Both engines imageview needs are the same on-device ML that subedit needs, so factor
them into one small standalone lib rather than duplicating per project.

- **Translation** already exists in subedit (`translate.ts` + `translate.worker.ts` +
  `worker-common.ts` + the translate slice of `backend.ts`), fully decoupled from
  cues: extract as-is.
- **OCR** does not exist yet in either project (subedit only *planned* it). Build the
  Tesseract.js Worker module **once, here**: imageview uses it now, subedit's planned
  PGS/VobSub importer uses it later. `worker-common.ts` is already the shared substrate
  for transformers.js Workers and serves a Tesseract.js Worker equally.

Proposal: `localml`, MIT, `github:hikashop-nicolas/localml`, subpath exports so a
consumer only pulls the engine it imports (each runs in its own lazy Worker, so the
two WASM engines never load together):

```
localml/ocr        -> runOcr(image: Blob|ImageData, opts) -> { text, words, ... }
localml/translate  -> runTranslate(texts: string[], opts) -> streamed string[]
```

This matches the family's habit of factoring shared engines out (mediaplay pulled
from Omnitext, richdoc consolidating docxedit+odtedit) and directly answers "make
both use the same stuff": imageview and subedit share one OCR and one translation
implementation, no drift.

Cost / sequencing: extracting translation means a **subedit refactor** (point
`transcribe/` at `localml`, re-pin, re-verify subedit's translate flow). Whisper/ASR
can stay in subedit for now (audio-specific) or move later. If you would rather not
touch subedit yet, the fallback is to build `localml` with OCR only now (new code,
no subedit churn) and fold translation in when subedit is next open, but that leaves
translation un-shared in the interim.

Naming note: `localml` is infra, not an editor, so it breaks the `*edit`/`*view`
naming of the family on purpose. Alternatives if you dislike it: `browserml`,
`clientml`, `webml`.

## Phased plan

- **Phase 0 - extract.** Scaffold `imageview` from the geoedit template; move the
  current read-only viewer in verbatim (zoom/fit, SVG inert, error states); demo +
  README + LICENSE; build dist. Repoint Omnitext at it; confirm byte-for-byte the
  same viewing behaviour. Ship this first: it closes the "own repo" half of #16 with
  zero behaviour change and de-risks the integration.
- **Phase 1 - QR/barcode (#15).** Click-to-detect: BarcodeDetector-first with
  zxing-wasm fallback, lazy first-click scan + cached hit-testing, info card, hover
  affordance on detected regions. Close #15. (No `localml` dependency.)
- **Phase 2 - `localml` + OCR (#16a).** Scaffold the `localml` lib; extract subedit's
  translate core + `worker-common` into it (refactor subedit to consume it, re-pin,
  re-verify); build the new Tesseract.js OCR Worker module. Wire imageview's OCR
  button (language picker, progress, result panel, copy / new-doc).
- **Phase 3 - translation (#16b).** Wire imageview's translate button to
  `localml/translate`; target-language pick; translate OCR output with streaming
  partials + model-download progress. Close #16.
- **Later (subedit, its own plan).** subedit's PGS/VobSub importer consumes
  `localml/ocr`; no reimplementation.

## Decisions (all settled)

- Viewer repo name = **imageview**; **extract directly** (no in-place interim).
- Translation + OCR live in a shared on-device ML lib, **`localml`**, built with
  **both engines** now: translation extracted from subedit (subedit refactored to
  consume it), OCR built new (Tesseract.js). Not the Chrome Translator API.
- QR is a **click-to-detect** interaction that opens an info card, not a toolbar scan
  and not an auto-scan-on-open badge.

No open decisions remain; ready to build from Phase 0.

## Verification

- Phase 0: golden check that an image opens and zoom/fit behave exactly as before;
  SVG stays inert; broken-image message still shows.
- Phase 1: a fixture PNG with a known QR: clicking on the code opens its info card
  with the expected string; clicking away from it still toggles zoom; verified on both
  a Chromium build (native path) and a forced-fallback build (zxing-wasm path).
- Phase 2: a fixture screenshot OCRs to expected text within tolerance; worker
  terminates on dispose (no leak).
- Phase 3: OCR-then-translate round-trips (e.g. a French screenshot to English) on
  both a WebGPU browser and a WASM-only one; the model-download bar rises monotonically;
  the worker terminates on dispose (no leak). subedit's own translate flow still works
  after the refactor (if decision A).
