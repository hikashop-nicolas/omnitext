# Omnitext

A browser-only, format-agnostic, **extensible text & document editor**. It runs entirely
client-side — no backend, no login, no upload — and is published as a static site on GitHub
Pages. The editing surface adapts to the file: code formats open in a code editor, CSV in a
grid, JSON as a tree, HTML/Markdown as rich text, and PDF / DOCX / ODT / spreadsheets in
dedicated in-browser editors.

**[▶ Live demo](https://hikashop-nicolas.github.io/omnitext/)** — open a file, edit it, and
save it back, all in your browser.

**[⬇ Android APK](https://github.com/hikashop-nicolas/omnitext/releases/download/android-latest/omnitext.apk)**
— Omnitext also runs as an Android app (Capacitor), bundling the same editor offline. The APK
is rebuilt automatically from `main`; sideload it (Android will warn about installing from an
unknown source). Not distributed through Google Play yet.

## What it does

Open a file (local disk via the File System Access API, or upload), edit it in the most
suitable surface, and save it back — nothing leaves the browser.

- **Text & code** (CodeMirror, syntax highlighting + validation): JSON, JSON5, YAML, XML,
  TOML, INI, Markdown, HTML, CSS, JavaScript, TypeScript, Python, SQL, shell, `.env`,
  `.properties`.
- **Structured surfaces**: CSV / TSV as an editable **grid**, JSON as a **tree**, HTML and
  Markdown as **rich text** (Quill / Milkdown), plus a read-only HTML **preview**.
- **Binary documents**, each edited *in place* (the parts you don't touch are preserved),
  via a dedicated standalone library:
  - **PDF** — [pdfedit](https://github.com/hikashop-nicolas/pdfedit)
  - **DOCX** — [docxedit](https://github.com/hikashop-nicolas/docxedit)
  - **ODT** — [odtedit](https://github.com/hikashop-nicolas/odtedit)
  - **XLSX / ODS** (formula-aware) — [sheetedit](https://github.com/hikashop-nicolas/sheetedit)
  - legacy **XLS** via a SheetJS-backed grid
- **Tools**: version **history** with diff.
- **Local-first**: IndexedDB autosave + crash recovery; UTF-8 / BOM and line endings
  preserved so text round-trips byte-for-byte.

A format that isn't recognised still opens in the text editor, so any text file is editable.

## Privacy

Everything runs on your machine. Files never leave the browser; there is no server, no
account, and no telemetry. That privacy guarantee is the point of the project.

## Architecture in one breath

The text (or, for binary files, the bytes) is the source of truth. Three module kinds plug
into a small core:

- **Format** — parses a file type into an opaque, format-owned model and serializes it back
  (region-splice, so untouched regions stay byte-identical).
- **Editor** — an editing surface that consumes a model or a generic view.
- **Tool** — a cross-cutting capability (diff, history, …).

The core (event bus, registries, host API, editor resolution) knows about none of them
specifically: it picks an editor per format (native pairing → generic view → text fallback),
and every file can always fall back to the text editor. Binary formats delegate the full
round-trip to a dedicated editor. The core imports no parser and no DOM editor widget.

The binary-document editors live in their own MIT repos (pdfedit, docxedit, odtedit,
sheetedit) and are consumed here as git dependencies, so each is reusable on its own.

## Scripts

```
npm run dev        # Vite dev server
npm test           # unit + integration tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
```

## Layout

```
src/core/      engine, event bus, registries, editor resolution, host types, encoding, session store
src/editors/   editing surfaces (codemirror, table, tree, preview, quill, milkdown, pdf, docx, odt, sheet)
src/formats/   format modules (json, json5, yaml, xml, toml, ini, markdown, html, css, csv, tsv,
               js, ts, python, sql, shell, dotenv, properties, pdf, docx, odt, xlsx, ods, xls)
src/tools/     cross-cutting tools (history / diff)
src/main.ts    the app: registers modules, wiring, open/save, detection, autosave, recovery
```

License: MIT.
