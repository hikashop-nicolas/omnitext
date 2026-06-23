# Shared rich-document editor core (richdoc)

Goal: stop building the same editor twice. docxedit and odtedit share ~80% of their
code in concept (UI, contenteditable, comments panel, track changes, image resize,
page/header/footer chrome, passthrough, accept/reject). Only the parse (bytes -> editable
model) and serialize (model -> bytes) layers are truly format-specific. Extract the shared
part into one core and express each format as a thin adapter over it.

NOT the goal: a single editor that hard-codes both schemas, and NOT format conversion
(odt<->docx). Each format stays native; only the engine is shared.

## The seam: HTML + a small structured side-channel

Both editors already use **contenteditable HTML as the intermediate model**. We make that
the contract. The core owns the HTML conventions; each adapter maps its XML to/from them.

Neutral HTML conventions (replace today's per-lib `docx-`/`odt-` prefixes with `rdoc-`):
- Passthrough (anything unmodelled): `<span|div data-rdoc-xml="…" contenteditable="false">`.
  The core treats these as opaque read-only; the adapter re-imports the XML on save.
- Comment range highlight: `<span class="rdoc-comment" data-cmt-id="…">…</span>`.
- New comment / reply markers: neutral elements carrying id/author/date/text the adapter
  turns into the format's comment markers + store entry.
- Tracked changes: `<ins class="rdoc-ins" data-author data-date>`, `<del class="rdoc-del">`,
  paragraph-mark `data-rdoc-rev="ins|del"`, formatting `<span class="rdoc-rprchange" data-old>`.
- Page-break marker, image (`<img>` data-URL + passthrough), table (read-only + passthrough):
  same neutral forms we already use.

### Adapter contract (per format)

```
interface FormatAdapter {
  sniff(bytes): boolean;                 // is this my format?
  read(bytes): RichDoc;                  // bytes -> editable model
  write(original: Uint8Array, edits: RichDocEdits): Uint8Array;  // model -> bytes
}
interface RichDoc {
  body: string;                          // editable HTML (neutral conventions)
  parts: { id: string; kind: "header"|"footer"; html: string }[];  // editable sub-parts
  comments: CommentThread[];             // normalized threads (author/date/text/reactions/replies/resolved)
  fontFaces?: string; fontUrls?: string[];  // embedded fonts
  defaultFont?: string;
  page?: { wPx: number; hPx: number; margins: … };
}
interface RichDocEdits {
  body: string;
  parts: { id: string; html: string }[];
  comments: { added; replies; reactions; resolved; deleted };  // the structured side-channel
}
```

The core knows nothing about OOXML/ODF; the adapter never knows about the toolbar/panel.

## Split: what's core vs adapter

Core (format-agnostic, built once):
- Contenteditable surface, page + header/footer bands, scroll/layout, CSS.
- Toolbar: B/I/U, colour, highlight/background, font, size, alignment, lists, link,
  insert image + resize + delete, page break, add comment, suggesting toggle, accept/reject.
- Comments side panel: anchoring, threads, reactions, reply/resolve/delete, popovers.
- Track changes: record (beforeinput), display, accept/reject, accept-all/reject-all.
- Passthrough plumbing, settings/author wiring, i18n scaffolding, the RichDoc/Edits contract.

Adapter (per format, the irreducible ~20%):
- read(): parse XML -> RichDoc (the format's runs/paragraphs/tables/images/comments/changes
  -> neutral HTML + normalized comments).
- write(): neutral HTML + edits -> XML, preserving untouched parts.
- Format quirks: OOXML inline run props vs **ODF named styles** (the odt adapter needs a
  style synthesiser: a bold run -> mint an automatic style and reference it).

## Repo / distribution

Three packages that version together. Options:
- A) Monorepo `richdoc/` with packages/core, packages/docx, packages/odt (recommended:
  shared dev, atomic changes, one test run). Changes today's "separate repos" setup.
- B) Keep separate repos: richdoc-core + docxedit/odtedit depend on it. More release churn.
Recommend A. Omnitext consumes one package exposing `createEditor(bytes)` that sniffs the
format and picks the adapter, so from Omnitext's side it stays a single editor module
(today's two adapters collapse to one import).

## Migration (docx stays the reference; tests are the guardrail)

1. Lock behaviour: docxedit has 22 tests, odtedit 5. Add a few more golden round-trips
   first so the refactor can't silently regress.
2. In the docxedit repo, split index.ts into `core` (UI/engine) + `docx adapter` (read/
   write), wired by the RichDoc contract, keeping every test green. This proves the seam
   with zero new infrastructure.
3. Promote `core` to its own package; docxedit = core + docx adapter.
4. Re-express odtedit as an odt adapter over core (delete its bespoke UI). It inherits the
   full feature set; remaining work is ODF read/write + the style synthesiser.
5. Omnitext: replace the two editor modules with one `richdoc` module (createEditor sniffs).

## Hard parts / risks

- Comments and tracked changes aren't pure HTML: existing markers round-trip as passthrough,
  but new comments/replies/reactions/resolve/delete flow through the structured `edits`
  side-channel, which each adapter applies to its own store (comments.xml+commentsExtended
  vs office:annotation / text:tracked-changes). The contract must cover these explicitly.
- ODF stores formatting in named styles, not inline -> style synthesiser (the main extra
  cost beyond moving code).
- Extraction regression risk -> mitigated by keeping docx working at every step + tests.
- Converging the data-attribute / class names (docx-* and odt-* -> rdoc-*) touches CSS,
  read, write, and the editor wiring in one pass.

## Decision points for review

1. Monorepo (A) vs separate repos (B)?
2. Do this now (before odt parity) vs after? (Recommend now: otherwise comments/track-
   changes/tables get built a second time for odt and then reconciled.)
3. Naming: `richdoc` core + `richdoc-docx` / `richdoc-odt`, or keep `docxedit`/`odtedit`
   names as the adapter packages?
4. Scope of v1 core: extract exactly today's docx feature set (safe), or also fold in the
   docx fidelity gaps (indent/spacing/styles) at the same time (more churn)?
