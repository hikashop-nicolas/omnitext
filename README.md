# Omnitext

A browser-only, format-agnostic, extensible text editor. It runs entirely client-side
(no backend, no login) and is meant to be published as a static site on GitHub Pages.
A small core engine surfaces events and a host API; formats, editors, and tools are
modules. See plan.md for the full design and plan-review.md for the adversarial review.

## Status: Phase 0 (foundation)

Working today:

- Core engine: event bus, registries (editor / format / tool / command), host API,
  and editor resolution (native pairing > generic view > text fallback).
- Editor module: CodeMirror 6 (the universal text editor), with format-driven syntax
  highlighting and a lint gutter wired to a format's diagnostics.
- Format modules: JSON (with syntax validation), Markdown, and CSV. JSON/Markdown are
  text-model (byte-exact editing); CSV uses a span-preserving model.
- Encoding: UTF-8 (with/without BOM) detection and preservation; line endings kept
  inside the canonical text so they round-trip.
- Storage: open/save to local disk (File System Access API, with download/upload
  fallback), plus IndexedDB autosave and crash recovery.

The gate result: the CSV round-trip spike proves byte-exact round-trip of untouched
rows (see src/formats/csv/roundtrip.ts and its tests), so structured editing can ship
with a strong guarantee, not "best-effort".

## Architecture in one breath

The text buffer is the source of truth. A format parses text into an opaque,
format-owned model and serializes it back (region-splice, so untouched regions stay
byte-identical). An editor is chosen per format; the text editor is always available
as a fallback because every file is text. Collaboration (future) binds per editor to
the editor's native CRDT binding, not to a shared model. The core imports no parser
and no DOM editor widget.

## Scripts

```
npm run dev        # Vite dev server
npm test           # run the unit + integration tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + static production build into dist/
```

## Layout

```
src/core/      engine, event bus, registries, resolve-editor, host types, encoding, session store
src/editors/   editor modules (codemirror)
src/formats/   format modules (json, markdown, csv + the csv round-trip spike)
src/main.ts    the app: wires modules, open/save, detection, autosave, recovery
```
