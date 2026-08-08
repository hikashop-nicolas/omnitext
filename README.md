# Omnitext

**One free app that opens and edits practically any file — entirely in your browser.**

Code, Word documents, spreadsheets, PDFs, Markdown, LaTeX, SVG, maps, images, slides, books,
audio/video, archives: Omnitext picks the right editing surface for each file (a code editor
for JSON, a grid for CSV and XLSX, rich text for DOCX, a vector editor for SVG, an interactive
map for GeoJSON/KML, a player for media, …), lets you edit, and saves the file back —
preserving everything you didn't touch.
No file ever fails to open: unknown text opens as plain text, unknown binary as a hex view.

## Why Omnitext

- **Free, no ads, no upsell** — every feature is available to everyone, always.
- **No login, no tracking** — no account, no telemetry, no cookie banner. It's a static
  site; your files never leave your device.
- **One app for everything** — instead of one website for PDFs, another for spreadsheets and
  a third for images, a single consistent app (and a single Android "Open with" target)
  handles them all.
- **Small and fast** — the shell is ~170 KB gzipped; each editor loads on demand only when
  you open its file type. Works offline as a PWA once visited; installing it (browser menu →
  Install) also registers Omnitext in your desktop's **"Open with"** menu for its file types
  on Chrome/Edge.
- **Open source, reusable in your projects** — MIT-licensed, including the standalone
  document-editor libraries it's built on ([pdfedit](https://github.com/hikashop-nicolas/pdfedit),
  [richdoc](https://github.com/hikashop-nicolas/richdoc),
  [sheetedit](https://github.com/hikashop-nicolas/sheetedit),
  [geoedit](https://github.com/hikashop-nicolas/geoedit)), which you can embed in your
  own apps, commercial ones included.
- **Multilingual** — the UI auto-detects your language (English, French, Japanese so far).

**[▶ Live demo](https://hikashop-nicolas.github.io/omnitext/)** — open a file, edit it, and
save it back, all in your browser.

**[⬇ Android APK](https://github.com/hikashop-nicolas/omnitext/releases/download/android-latest/omnitext.apk)**
— Omnitext also runs as an Android app (Capacitor), bundling the same editor offline, and
registers in Android's **"Open with"** chooser so you can hand it files from any app. The APK
is rebuilt automatically from `main`; sideload it (Android will warn about installing from an
unknown source). Omnitext is also **[on Google Play](https://play.google.com/store/apps/details?id=app.omnitext)**,
which is the easier route if you just want to install it.

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
- **Maps** — GeoJSON, KML, KMZ and GPX open in an interactive **map editor**
  ([geoedit](https://github.com/hikashop-nicolas/geoedit)): draw and reshape features, edit
  their properties and colours, measure distance/area, undo/redo, all spliced back into the
  file byte-for-byte. TopoJSON, WKT and Shapefiles (`.shp`) open read-only (export them to
  an editable format).
- **Subtitles** — SRT, WebVTT, ASS and SSA open in a **subtitle editor**
  ([subedit](https://github.com/hikashop-nicolas/subedit)): a cue list with per-cue timing
  and text, a video/audio preview with a waveform timeline to retime cues, an ASS style
  picker, and automatic transcription/translation, all byte-preserving your file. The raw
  text is one click away in the View switcher.
- **Design files** (read-only): **PSD** (Photoshop) renders the flattened composite and
  layer tree ([@webtoon/psd](https://github.com/webtoon/psd)); **AI** (Illustrator) renders
  its PDF-compatible artwork via pdf.js.
- **Fonts** (read-only): **TTF / OTF / WOFF** show a specimen, a glyph grid and the
  name/metadata table ([opentype.js](https://github.com/opentypejs/opentype.js)).
- **Data**: **SQLite** databases (`.db`/`.sqlite`) open a table browser with an ad-hoc
  query box ([sql.js](https://github.com/sql-js/sql.js)); **Apache Parquet** (`.parquet`)
  and **Arrow / Feather** (`.arrow`) open as a grid with column types
  ([hyparquet](https://github.com/hyparam/hyparquet),
  [apache-arrow](https://github.com/apache/arrow)); **Jupyter notebooks** (`.ipynb`) render
  markdown, code and output cells ([notebookjs](https://github.com/jsvine/notebookjs)), and
  stay editable as raw JSON.
- **3D & CAD** (read-only): **STL / PLY / OBJ / glTF / GLB** open in a WebGL viewer with
  free rotation ([three.js](https://github.com/mrdoob/three.js)); **DXF** drawings render
  in a 2D CAD viewer with pan/zoom ([dxf-viewer](https://github.com/vagran/dxf-viewer)).
- **DICOM** (`.dcm` medical images, read-only) — renders the image with window/level plus
  the tag metadata ([dicom-parser](https://github.com/cornerstonejs/dicomParser)).
- **Email & contacts** (read-only): **`.eml`** and Outlook **`.msg`** messages render
  headers, body and attachments, with remote content (tracking pixels) blocked; **`.ics`**
  calendar events and **`.vcf`** contacts render as cards
  ([ical.js](https://github.com/kewisch/ical.js)), editable as text.
- **Structured surfaces**: CSV / TSV as an editable **grid**, JSON as a **tree**, HTML and
  Markdown as **rich text** (Quill / Milkdown), plus a read-only HTML **preview**.
- **Binary documents**, each edited *in place* (the parts you don't touch are preserved),
  via a dedicated standalone library:
  - **PDF** — [pdfedit](https://github.com/hikashop-nicolas/pdfedit)
  - **DOCX / ODT** — [richdoc](https://github.com/hikashop-nicolas/richdoc)
  - **XLSX / ODS / XLSM** (formula-aware, with chart and pivot-table create/edit, a Power Query
    editor, and **VBA macros that run and can be edited**) — [sheetedit](https://github.com/hikashop-nicolas/sheetedit)
  - legacy **XLS** via a SheetJS-backed grid
- **RTF** — Rich Text Format documents rendered read-only via
  [rtf.js](https://github.com/tbluemel/rtf.js) (view only, no editing).
- **PPTX** — PowerPoint presentations rendered read-only as a scrollable slide list via
  [pptx-renderer](https://github.com/aiden0z/pptx-renderer) (shapes, tables, charts, images).
- **EPUB** — books rendered read-only as paginated pages via
  [epub-js](https://github.com/intity/epub-js), with keyboard and arrow navigation.
- **MOBI / AZW3 / FB2** — non-EPUB ebooks paginated read-only via
  [foliate-js](https://github.com/johnfactotum/foliate-js) (DRM-free files only).
- **HEIC / HEIF** (iPhone photos, read-only) — decoded to a canvas
  ([libheif-js](https://github.com/catdad-experiments/libheif-js)).
- **Camera RAW** (CR2/CR3, NEF, ARW, DNG, …, read-only) — shows the embedded JPEG preview
  and the EXIF shot metadata (camera, lens, exposure) via
  [exifr](https://github.com/MikeKovarik/exifr).
- **Images** (PNG/JPG/GIF/WebP/AVIF/BMP/ICO) — shown in a read-only viewer by default; switch
  to the **image editor** ([Filerobot](https://github.com/scaleflex/filerobot-image-editor):
  crop, rotate, flip, resize, filters, annotate, draw, text) to edit and save. Editing
  re-encodes the raster (an animated GIF flattens to one frame).
- **Viewers** (read-only): multi-page **TIFF** images
  ([UTIF.js](https://github.com/photopea/UTIF.js)) and **`.torrent`** metadata (name, size,
  trackers, file tree, info-hash). **audio & video** — via the standalone
  [mediaplay](https://github.com/hikashop-nicolas/mediaplay) library: the common web formats
  plus `.mkv`, `.mov`, `.mts`/`.m2ts`, `.3gp` and friends; when the browser can't play a
  container directly, the file is repackaged in memory
  ([mediabunny](https://github.com/Vanilagy/mediabunny), loaded on demand) and played without
  re-encoding, and Dolby **AC-3 / E-AC-3** audio (which no browser decodes) is decoded by a
  bundled FFmpeg WASM decoder and played in sync with the video (DTS/TrueHD show a clear
  notice). **Apple Lossless (ALAC)**, which only Safari plays, is decoded by a 21 KB WASM
  build of Apple's own decoder, fetched only when a file turns out to be ALAC. Text
  subtitles embedded in MKV/WebM (SRT, ASS, WebVTT tracks; UTF-8 incl. CJK) are
  extracted and shown, with a CC menu to switch subtitle tracks, load an external
  `.srt`/`.ass`/`.vtt` file (legacy encodings auto-detected), and switch between the file's
  audio tracks. ASS subtitles render fully styled via
  [libass](https://github.com/libass/JavascriptSubtitlesOctopus) (WASM, loaded on demand),
  using the fonts embedded in the file — CJK signs and karaoke included. Player shortcuts:
  space, F (fullscreen), M (mute), S/D (speed, remembered across files), C (subtitles
  on/off), arrows (seek/volume); they keep working when the native controls have focus.
  And **archives** — `.zip`/`.jar`/`.cbz`,
  `.tar`, `.tar.gz`/`.tgz`, and `.gz` (via [fflate](https://github.com/101arrowz/fflate)),
  plus **7z, RAR, and tar.xz / tar.bz2** (via
  [libarchive-wasm](https://github.com/nika-begiashvili/libarchivejs), loaded on demand) —
  where you can browse entries, open one inside Omnitext, extract it, or (for the zip/tar
  family) edit it and save it back into the archive. Anything else opens in a **hex**
  view, so no file ever fails to open.
- **Multilingual**: the UI auto-detects your language (English, French and Japanese today;
  adding one is a single file), and each editor library translates its own UI independently.
- **Tools**: version **history** with diff, and live **collaboration** (below).
- **Local-first**: IndexedDB autosave + crash recovery; UTF-8 / BOM and line endings
  preserved so text round-trips byte-for-byte.

Any unrecognised *text* file still opens as plain text in the code editor; truly binary files
fall back to the hex viewer — so nothing ever fails to open.

**Which build am I on?** Settings shows the commit the running build came from, with a
*Check for updates* button beside it. Installed as an app, Omnitext keeps serving the build
it has until every window is closed, so that a page never loses a chunk it might still need;
the button is how you say "now" instead of waiting.

## Editing together

Share a link and two or more people edit the same file at once, in the same editor, with
each other's cursors visible. There is no server holding the document and no account: the
link carries the room, the browsers connect to each other directly, and the file goes from
one machine to another and nowhere else.

It works in the code editor, the subtitle editor, the spreadsheet, the rich-text editor and
the PDF editor, and it covers what those editors can actually change: not only the text, but
the style table of a subtitle file, a workbook's sheets, images, charts, pivots, named
ranges and query definitions, and a document's headers, footnotes, comments and tracked
changes.

Concurrent edits merge rather than overwrite. Two people in different paragraphs, different
cues or different cells never collide; two people inside the *same* paragraph or the same
line of dialogue merge as well, because a change is sent as the smallest edit that explains
it rather than as a new copy of the whole thing. A cue's timing and its wording are separate
edits, so one person retiming a track while another proofreads it keeps both.

Two things are deliberately never done on your behalf: refreshing someone else's Power Query
(it reaches the network from your machine, including addresses only you can see) and running
someone else's macro. Their definitions travel; running them is your decision.

Optionally the person who shared the link approves each newcomer before they get the
document. That is a courtesy, not a security boundary, and the app says so: anyone holding
the link is in the room and can see who else is there.

## Privacy

Everything runs on your machine. Files never leave the browser; there is no server, no
account, and no telemetry. That privacy guarantee is the point of the project.

Collaboration keeps that promise: peers connect directly and the document passes between
them. What is not private is the room itself. Finding each other uses a public relay, which
learns that some browsers are talking, and a session has no identity in it at all: names are
self-chosen, so a name says what someone typed and not who they are. Anyone with the link
can join.

## Architecture in one breath

The text (or, for binary files, the bytes) is the source of truth. Three module kinds plug
into a small core:

- **Format** — parses a file type into an opaque, format-owned model and serializes it back
  (region-splice, so untouched regions stay byte-identical).
- **Editor** — an editing surface that consumes a model or a generic view.
- **Tool** — a cross-cutting capability (diff, history, collaboration, …).

The core (event bus, registries, host API, editor resolution) knows about none of them
specifically: it picks an editor per format (native pairing → generic view → text fallback),
and every file can always fall back to the text editor. Binary formats delegate the full
round-trip to a dedicated editor. The core imports no parser and no DOM editor widget.

Collaboration is a Tool plus one small binding per editor. The Tool owns the session,
presence, the transfer of the file to a joiner and the payload channel for images; the
binding is the only part that knows what a paragraph or a cue is. The shared state is a
[Yjs](https://github.com/yjs/yjs) document over WebRTC ([Trystero](https://github.com/dmotz/trystero)),
and every editor library grew the same small contract for it: report what a local edit
touched, take a peer's change without reporting it back, and hand undo to the host so one
person's Ctrl+Z cannot take back another's work.

The dedicated editor libraries live in their own MIT repos (pdfedit, richdoc, sheetedit,
geoedit, subedit, imageview, mediaplay) and are consumed here as git dependencies, so each is
reusable on its own. Those libraries have their own libraries in turn: sheetedit's Power Query
engine ([mlang](https://github.com/hikashop-nicolas/mlang)) and VBA engine
([vbalang](https://github.com/hikashop-nicolas/vbalang)), and the shared on-device OCR and
translation models ([localml](https://github.com/hikashop-nicolas/localml)).
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
               odt, sheet, svgeditor, geoeditor, latexpreview, filerobot image editor) and
               read-only viewers (rtf, pptx, epub, image, media, archive, psdviewer, aiviewer,
               fontviewer, sqliteviewer, ipynbviewer, emailviewer, pimviewer, tiffviewer,
               torrentviewer, model3dviewer, parquetviewer, heicviewer, ebookviewer,
               dxfviewer, dicomviewer, recordsviewer, rawviewer, binary/hex)
src/formats/   format modules (json/json5/yaml/xml/toml/ini/markdown/html/css/js/ts/python/
               sql/shell/dotenv/properties, latex, svg, geojson/kml/kmz/gpx/topojson/wkt/shp,
               pdf/docx/odt/xlsx/ods/xls, pptx, epub, rtf, psd, ai, font, sqlite, ipynb,
               eml/msg, ics/vcf, tiff, torrent, model3d, parquet, heic, ebook, dxf, dicom,
               arrow, raw, the codemirror-formats long-tail table, and binary-viewers for
               images/media/archives)
src/i18n/      app-shell translations (en, fr, ja) + the auto-detect runtime
src/tools/     cross-cutting tools (history / diff)
src/main.ts    the app: registers modules, wiring, open/save, detection, autosave, recovery
```

License: MIT.
