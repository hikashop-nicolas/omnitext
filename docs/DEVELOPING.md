# Developing Omnitext

Omnitext is a browser-only, format-agnostic editor: a small core plus modules. This page is
the developer view. The [README](../README.md) is the user one.

## Architecture in one breath

The text (or, for binary files, the bytes) is the source of truth. Three module kinds plug
into a small core:

- **Format**: parses a file type into an opaque, format-owned model and serializes it back
  (region-splice, so untouched regions stay byte-identical).
- **Editor**: an editing surface that consumes a model or a generic view.
- **Tool**: a cross-cutting capability (diff, history, collaboration).

The core (event bus, registries, host API, editor resolution) knows about none of them
specifically: it picks an editor per format (native pairing, then generic view, then text
fallback), and every file can always fall back to the text editor. Binary formats delegate the
full round trip to a dedicated editor. The core imports no parser and no DOM editor widget.

Read-only surfaces (preview, rtf, image, media, archive and hex viewers) carry a `readOnly`
flag, so the app hides Save for them. Switching the View keeps the previous editor alive, so
its undo history survives a round trip.

Third-party editors load on demand: [svgedit](https://github.com/SVG-Edit/svgedit) for SVG,
[latex.js](https://github.com/michael-brade/LaTeX.js) for the LaTeX preview,
[rtf.js](https://github.com/tbluemel/rtf.js) for RTF, and
[Filerobot](https://github.com/scaleflex/filerobot-image-editor) for image editing. Archives
use [fflate](https://github.com/101arrowz/fflate) plus a small built-in tar codec.

## Collaboration

Collaboration is a Tool plus one small binding per editor. The Tool owns the session,
presence, the transfer of the file to a joiner and the payload channel for images; the binding
is the only part that knows what a paragraph or a cue is.

The shared state is a [Yjs](https://github.com/yjs/yjs) document over WebRTC
([Trystero](https://github.com/dmotz/trystero)), and every editor library grew the same small
contract for it: report what a local edit touched, take a peer's change without reporting it
back, and hand undo to the host so one person's Ctrl+Z cannot take back another's work.

It covers what those editors can actually change: not only the text, but the style table of a
subtitle file, a workbook's sheets, images, charts, pivots, named ranges and query
definitions, and a document's headers, footnotes, comments and tracked changes. A change is
sent as the smallest edit that explains it rather than as a new copy of the whole thing, so a
cue's timing and its wording are separate edits.

Optionally the person who shared the link approves each newcomer before they get the document.
That is a courtesy, not a security boundary, and the app says so.

## In-house libraries

The dedicated editor libraries live in their own MIT repos and are consumed here as git
dependencies, so each one is reusable on its own: pdfedit, richdoc, sheetedit, geoedit,
subedit, imageview, mediaplay. Those libraries have their own libraries in turn: sheetedit's
Power Query engine ([mlang](https://github.com/hikashop-nicolas/mlang)) and VBA engine
([vbalang](https://github.com/hikashop-nicolas/vbalang)), and the shared on-device OCR and
translation models ([localml](https://github.com/hikashop-nicolas/localml)).

They are pinned in `package-lock.json`. `npm run bump-libs` reinstalls all of them, then
typechecks and runs the tests.

## Scripts

```
npm run dev        # Vite dev server
npm test           # unit + integration tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run cap:sync   # build, then sync the Android (Capacitor) project
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
src/i18n/      app-shell translations (en, fr, ja, es, de, pt, ru, zh) + auto-detect
src/tools/     cross-cutting tools (history / diff)
src/main.ts    the app: registers modules, wiring, open/save, detection, autosave, recovery
```

The shell is about 170 KB gzipped; every editor is a separate chunk, loaded the first time a
file needs it.

## Format coverage, and what does the work

- **Text and code** (CodeMirror, highlighting and validation): JSON, JSON5, YAML, XML, TOML,
  INI, Markdown, HTML, CSS, JS/TS, Python, SQL, shell, `.env`, `.properties`, plus about sixty
  more languages: C/C++/C#/Java, Rust, Go, Ruby, Perl, Lua, Haskell, Swift, Kotlin, Scala, R,
  Julia, Fortran, COBOL, Pascal, Clojure/Lisp/Scheme, PowerShell, assembly, SCSS/LESS, diff,
  reStructuredText, AsciiDoc, BibTeX, logs and more.
- **LaTeX**: `.tex` with highlighting and a live rendered HTML preview (latex.js).
- **SVG**: a WYSIWYG vector editor ([svgedit](https://github.com/SVG-Edit/svgedit)), with the
  XML source one click away in the View switcher.
- **Maps**: GeoJSON, KML, KMZ and GPX in an interactive map editor
  ([geoedit](https://github.com/hikashop-nicolas/geoedit)): draw and reshape features, edit
  properties and colours, measure distance and area, undo/redo, all spliced back into the file
  byte for byte. TopoJSON, WKT and Shapefiles (`.shp`) open read-only.
- **Subtitles**: SRT, WebVTT, ASS and SSA in a subtitle editor
  ([subedit](https://github.com/hikashop-nicolas/subedit)): cue list with per-cue timing and
  text, a media preview with a waveform timeline to retime cues, an ASS style picker, and
  automatic transcription and translation, byte-preserving throughout.
- **Design files** (read-only): PSD renders the flattened composite and the layer tree
  ([@webtoon/psd](https://github.com/webtoon/psd)); AI renders its PDF-compatible artwork via
  pdf.js.
- **Fonts** (read-only): TTF, OTF and WOFF show a specimen, a glyph grid and the name table
  ([opentype.js](https://github.com/opentypejs/opentype.js)).
- **Data**: SQLite (`.db`, `.sqlite`) opens a table browser with an ad-hoc query box
  ([sql.js](https://github.com/sql-js/sql.js)); Parquet and Arrow/Feather open as a grid with
  column types ([hyparquet](https://github.com/hyparam/hyparquet),
  [apache-arrow](https://github.com/apache/arrow)); Jupyter notebooks render markdown, code and
  output cells ([notebookjs](https://github.com/jsvine/notebookjs)) and stay editable as raw
  JSON.
- **3D and CAD** (read-only): STL, PLY, OBJ, glTF and GLB in a WebGL viewer
  ([three.js](https://github.com/mrdoob/three.js)); DXF drawings in a 2D CAD viewer with pan
  and zoom ([dxf-viewer](https://github.com/vagran/dxf-viewer)).
- **DICOM** (`.dcm`, read-only): the image with window/level plus the tag metadata
  ([dicom-parser](https://github.com/cornerstonejs/dicomParser)).
- **Email and contacts** (read-only): `.eml` and Outlook `.msg` render headers, body and
  attachments with remote content blocked; `.ics` events and `.vcf` contacts render as cards
  ([ical.js](https://github.com/kewisch/ical.js)) and stay editable as text.
- **Structured surfaces**: CSV/TSV as an editable grid, JSON as a tree, HTML and Markdown as
  rich text (Quill / Milkdown), plus a read-only HTML preview.
- **Binary documents**, each edited in place through a dedicated standalone library: PDF
  ([pdfedit](https://github.com/hikashop-nicolas/pdfedit)), DOCX and ODT
  ([richdoc](https://github.com/hikashop-nicolas/richdoc)), XLSX, ODS and XLSM
  ([sheetedit](https://github.com/hikashop-nicolas/sheetedit), formula-aware, with chart and
  pivot create/edit, a Power Query editor, and VBA macros that run and can be edited). Legacy
  XLS goes through a SheetJS-backed grid.
- **RTF** (read-only): [rtf.js](https://github.com/tbluemel/rtf.js).
- **PPTX** (read-only): a scrollable slide list with shapes, tables, charts and images
  ([pptx-renderer](https://github.com/aiden0z/pptx-renderer)).
- **EPUB** (read-only): paginated pages via [epub-js](https://github.com/intity/epub-js).
  MOBI, AZW3 and FB2 (DRM-free only) via
  [foliate-js](https://github.com/johnfactotum/foliate-js).
- **HEIC/HEIF** (read-only): decoded to a canvas
  ([libheif-js](https://github.com/catdad-experiments/libheif-js)).
- **Camera RAW** (CR2/CR3, NEF, ARW, DNG and friends, read-only): the embedded JPEG preview
  plus the EXIF shot metadata ([exifr](https://github.com/MikeKovarik/exifr)).
- **Images** (PNG, JPG, GIF, WebP, AVIF, BMP, ICO): a read-only viewer by default; the View
  switcher opens the image editor
  ([Filerobot](https://github.com/scaleflex/filerobot-image-editor): crop, rotate, flip,
  resize, filters, annotate, draw, text). Editing re-encodes the raster, and an animated GIF
  flattens to one frame.
- **Audio and video**: the [mediaplay](https://github.com/hikashop-nicolas/mediaplay) library,
  with its own control bar and hover thumbnails on the timeline. The common web formats plus
  `.mkv`, `.mov`, `.mts`/`.m2ts`, `.3gp` and friends; when the browser cannot play a container
  directly, the file is repackaged in memory
  ([mediabunny](https://github.com/Vanilagy/mediabunny), loaded on demand) and played without
  re-encoding. Dolby AC-3 and E-AC-3, which no browser decodes, are decoded by a bundled FFmpeg
  WASM decoder and played in sync with the video (DTS and TrueHD show a clear notice). Apple
  Lossless, which only Safari plays, is decoded by a 21 KB WASM build of Apple's own decoder,
  fetched only when a file turns out to be ALAC. Text subtitles embedded in MKV/WebM (SRT, ASS,
  WebVTT, UTF-8 including CJK) are extracted, with a menu to switch subtitle tracks, load an
  external `.srt`/`.ass`/`.vtt` (legacy encodings auto-detected) and switch audio tracks. ASS
  renders fully styled via [libass](https://github.com/libass/JavascriptSubtitlesOctopus)
  (WASM, on demand) using the fonts embedded in the file, karaoke included. Shortcuts: space,
  F, M, S/D (speed, remembered across files), C, arrows.
- **Archives**: `.zip`/`.jar`/`.cbz`, `.tar`, `.tar.gz`/`.tgz` and `.gz` via
  [fflate](https://github.com/101arrowz/fflate), plus 7z, RAR and tar.xz / tar.bz2 via
  [libarchive-wasm](https://github.com/nika-begiashvili/libarchivejs) (on demand). Browse
  entries, open one inside Omnitext, extract it, or (zip and tar family) edit it and save it
  back into the archive.
- **Anything else**: unknown text opens in the code editor, truly binary files in the hex
  viewer, so nothing ever fails to open.

**Local-first**: IndexedDB autosave and crash recovery; UTF-8 and BOM handling and line endings
preserved so text round-trips byte for byte.

## Android

The Android app is the same web build wrapped with Capacitor (`android/`), registered in
Android's "Open with" chooser. `npm run cap:sync` builds the web app and syncs it into the
project. The APK attached to the `android-latest` release is rebuilt from `main` by CI.

## Licensing

Omnitext is MIT, and so are the in-house libraries. Two bundled libraries are LGPL rather than
MIT, each loaded on demand as its own WebAssembly module and neither inlined into the app: the
libav.js audio decoders (`public/libav/NOTICE.md`) and 7-Zip, used to write `.7z` archives
(`public/7z/NOTICE.md`). Using them does not change Omnitext's own licence.
