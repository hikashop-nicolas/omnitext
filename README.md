# Omnitext

A browser-only, **open-anything** text & document editor. It runs entirely client-side — no
backend, no login, no upload — and is published as a static site on GitHub Pages. The editing
surface adapts to the file: code in a code editor, CSV in a grid, JSON as a tree, HTML/Markdown
as rich text, LaTeX with a live preview, SVG in a vector editor, PDF / DOCX / ODT / spreadsheets
in dedicated in-browser editors, and RTF, images, audio/video and archives in viewers — with an
opt-in raster image editor. The interface is multilingual and auto-detects your language.

**[▶ Live demo](https://hikashop-nicolas.github.io/omnitext/)** — open a file, edit it, and
save it back, all in your browser.

**[⬇ Android APK](https://github.com/hikashop-nicolas/omnitext/releases/download/android-latest/omnitext.apk)**
— Omnitext also runs as an Android app (Capacitor), bundling the same editor offline, and
registers in Android's **"Open with"** chooser so you can hand it files from any app. The APK
is rebuilt automatically from `main`; sideload it (Android will warn about installing from an
unknown source). Not distributed through Google Play yet.

## What it does

Open a file (local disk via the File System Access API, or upload; on Android via "Open
with"), edit it in the most suitable surface, and save it back — nothing leaves the browser.

- **Text & code** (CodeMirror, highlighting + validation): JSON, JSON5, YAML, XML, TOML, INI,
  Markdown, HTML, CSS, JS/TS, Python, SQL, shell, `.env`, `.properties`, **plus ~60 more
  languages** — C/C++/C#/Java, Rust, Go, Ruby, Perl, Lua, Haskell, Swift, Kotlin, Scala, R,
  Julia, Fortran, COBOL, Pascal, Clojure/Lisp/Scheme, PowerShell, assembly, SCSS/LESS, diff,
  reStructuredText, AsciiDoc, BibTeX, logs, and more.
- **LaTeX** — edit `.tex` with highlighting, with a live rendered HTML **preview** (latex.js).
- **SVG** — a full WYSIWYG **vector editor** ([svgedit](https://github.com/SVG-Edit/svgedit)),
  with the XML source one click away in the View switcher.
- **Structured surfaces**: CSV / TSV as an editable **grid**, JSON as a **tree**, HTML and
  Markdown as **rich text** (Quill / Milkdown), plus a read-only HTML **preview**.
- **Binary documents**, each edited *in place* (the parts you don't touch are preserved),
  via a dedicated standalone library:
  - **PDF** — [pdfedit](https://github.com/hikashop-nicolas/pdfedit)
  - **DOCX / ODT** — [richdoc](https://github.com/hikashop-nicolas/richdoc)
  - **XLSX / ODS** (formula-aware) — [sheetedit](https://github.com/hikashop-nicolas/sheetedit)
  - legacy **XLS** via a SheetJS-backed grid
- **RTF** — Rich Text Format documents rendered read-only via
  [rtf.js](https://github.com/tbluemel/rtf.js) (view only, no editing).
- **PPTX** — PowerPoint presentations rendered read-only as a scrollable slide list via
  [pptx-renderer](https://github.com/aiden0z/pptx-renderer) (shapes, tables, charts, images).
- **EPUB** — books rendered read-only as paginated pages via
  [epub-js](https://github.com/intity/epub-js), with keyboard and arrow navigation.
- **Images** (PNG/JPG/GIF/WebP/AVIF/BMP/ICO) — shown in a read-only viewer by default; switch
  to the **image editor** ([Filerobot](https://github.com/scaleflex/filerobot-image-editor):
  crop, rotate, flip, resize, filters, annotate, draw, text) to edit and save. Editing
  re-encodes the raster (an animated GIF flattens to one frame).
- **Viewers** (read-only): **audio & video** — the common web formats plus `.mkv`, `.mov`,
  `.mts`/`.m2ts`, `.3gp` and friends; when the browser can't play a container directly, the
  file is repackaged in memory ([mediabunny](https://github.com/Vanilagy/mediabunny), loaded
  on demand) and played without re-encoding. Player shortcuts: space, F, M, arrows.
  And **archives** — `.zip`/`.jar`/`.cbz`,
  `.tar`, `.tar.gz`/`.tgz`, and `.gz` — where you can browse entries, open one inside Omnitext,
  extract it, or edit it and save it back into the archive. Anything else opens in a **hex**
  view, so no file ever fails to open.
- **Multilingual**: the UI auto-detects your language (English, French and Japanese today;
  adding one is a single file), and each editor library translates its own UI independently.
- **Tools**: version **history** with diff.
- **Local-first**: IndexedDB autosave + crash recovery; UTF-8 / BOM and line endings
  preserved so text round-trips byte-for-byte.

Any unrecognised *text* file still opens as plain text in the code editor; truly binary files
fall back to the hex viewer — so nothing ever fails to open.

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

The binary-document editors live in their own MIT repos (pdfedit, richdoc, sheetedit)
and are consumed here as git dependencies, so each is reusable on its own.
Read-only surfaces (preview, rtf, image/media/archive/hex viewers) carry a `readOnly` flag, so
the app hides Save for them. Switching the View keeps the previous editor alive, so its undo
history survives a round-trip. Third-party editors are loaded on demand: [svgedit](https://github.com/SVG-Edit/svgedit)
for SVG, [latex.js](https://github.com/michael-brade/LaTeX.js) for the LaTeX preview,
[rtf.js](https://github.com/tbluemel/rtf.js) for RTF rendering, and
[Filerobot](https://github.com/scaleflex/filerobot-image-editor) for image editing;
archives use [fflate](https://github.com/101arrowz/fflate) plus a small built-in tar codec.

## Scripts

```
npm run dev        # Vite dev server
npm test           # unit + integration tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
```

## Layout

```
src/core/      engine, event bus, registries, editor resolution, host types, encoding,
               session store, archive + tar codec
src/editors/   editing surfaces (codemirror, table, tree, preview, quill, milkdown, pdf, docx,
               odt, sheet, svgeditor, latexpreview, filerobot image editor) and read-only
               viewers (rtf, pptx, epub, image, media, archive, binary/hex)
src/formats/   format modules (json/json5/yaml/xml/toml/ini/markdown/html/css/js/ts/python/
               sql/shell/dotenv/properties, latex, svg, pdf/docx/odt/xlsx/ods/xls, pptx, epub,
               rtf, the codemirror-formats long-tail table, and binary-viewers for
               images/media/archives)
src/i18n/      app-shell translations (en, fr, ja) + the auto-detect runtime
src/tools/     cross-cutting tools (history / diff)
src/main.ts    the app: registers modules, wiring, open/save, detection, autosave, recovery
```

License: MIT.
