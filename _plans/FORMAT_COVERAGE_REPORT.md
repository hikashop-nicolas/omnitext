# Omnitext format coverage: gap analysis and expansion report

Date: 2026-07-10. Purpose: ground the next round of format work in real-world usage
data plus a survey of browser-only (client-side, no server) libraries, so we extend
coverage where it matters most and where the licence fits an MIT static site.

Method: three research passes. (1) which file formats are actually most used, from
usage datasets (W3Techs, HTTP Archive, Stack Overflow survey) and industry sources.
(2) permissive browser libraries for office/data gap formats. (3) permissive browser
libraries for media/3D/image gap formats. Sources are listed at the end.

Constraint that shapes everything: Omnitext is a static site, files never leave the
device, so only libraries that run fully in the browser qualify (pure JS or WASM). A
tile fetch or a font download is fine; sending file contents out is not. Licence
matters: the app is MIT, so AGPL is a dealbreaker, GPL is a hazard (contaminates the
app unless isolated), and LGPL/CDDL/MPL are acceptable when the library ships
unmodified as a separate bundled artifact.

## 1. Where Omnitext already stands

Measured against the tier-1 "most used" set, coverage is already very strong. Tier 1
formats and their status:

| Format | Status in Omnitext |
|---|---|
| PDF | Edit (pdfedit) |
| PNG / JPEG / GIF / WebP / AVIF / BMP / ICO | View + raster edit (Filerobot) |
| SVG | Vector edit (svgedit) |
| DOCX (+ ODT) | Edit in place (richdoc) |
| XLSX (+ ODS, legacy XLS) | Edit in place (sheetedit / SheetJS) |
| JSON / CSV / TSV / YAML / XML / TOML / INI | Code editor, grid, tree |
| Markdown | Rich text + source |
| ZIP / JAR / CBZ / TAR / GZ / TGZ | Browse, extract, edit back |
| MP4 / MP3 and the common A/V containers | Play + repackage (mediabunny) |
| Fonts (WOFF2 / TTF / OTF) | NOT covered (only tier-1 gap) |

So the headline: of the twelve strongest formats by usage, eleven are covered and the
only tier-1 gap is fonts. The rest of the opportunity is in tier 2 and tier 3, where
the questions are value, licence, and effort rather than "does it matter."

Already covered beyond tier 1: PPTX, EPUB, RTF, PSD, AI (read-only); the full geo set
(GeoJSON, KML, KMZ, GPX, TopoJSON, WKT, Shapefile); ~60 code languages; LaTeX preview;
hex fallback so nothing fails to open.

## 2. Recommended additions, prioritised

Ranked by (value x fit) / effort. Each row: the best browser library, its licence,
whether it can edit or only view, and the integration weight. Libraries flagged GPL or
AGPL are called out separately in section 4; they are not in this recommended list.

### Tier A: quick wins (pure JS or small WASM, permissive, high value)

| Format | Library | Licence | Cap | Weight | Notes |
|---|---|---|---|---|---|
| Fonts TTF/OTF/WOFF | opentype.js (+ wawoff2 for WOFF2) | MIT | Preview glyphs + edit name/metadata | Small | Only tier-1 gap. Glyph specimen to canvas/SVG, edit family/copyright/version, export. WOFF2 needs the wawoff2 WASM shim. |
| SQLite .db/.sqlite | sql.js | MIT | Full read + write (browse tables, edit rows, run SQL, re-export) | ~1 MB WASM, worker | Fits the load, edit, download model exactly. Most-deployed DB engine; ships as a file. |
| Jupyter .ipynb | notebookjs or ipynb2html to render; our JSON/code editors to edit cells | BSD/MIT | View + edit cell source (no execution) | Small | An ipynb is JSON: render markdown/output read-only, edit source cells in CodeMirror, write back. Skip JupyterLite (tens of MB). |
| iCalendar .ics + vCard .vcf | ical.js | MPL-2.0 | Full round-trip | Small | One library covers both, parse and serialize. MPL is weak-copyleft, fine consumed unmodified; flag it. |
| Email .eml | postal-mime | MIT | View (headers, body, attachments) | Small | Browser-native. Render HTML body sandboxed in an iframe. |
| Email .msg (Outlook) | @kenjiuno/msgreader (+ decompressrtf) | MIT | View | Small | OLE compound file, decompresses the RTF body. Or convert to .eml. |
| TIFF (multi-page) | UTIF.js | MIT | View all pages, basic encode | Tiny, pure JS | The TIFF engine behind Photopea. Iterate IFDs for pages. |
| .torrent | @ctrl/torrent-file | MIT | View metadata (name, hash, files, trackers) | Tiny | Buffer-free bencode, works in-browser with no polyfills. Metadata only (that is all a torrent holds). |
| .plist (Apple) | plist | MIT | View + edit (XML write) | Small | Auto-detects binary bplist00; safe editable target is XML plist. Maps onto a tree/JSON-like view. |
| .wasm | wabt (wasm2wat) | Apache-2.0 | Disassemble to WAT, reassemble | ~1-2 MB WASM | Official WebAssembly tool. Zero-dep quick metadata via WebAssembly.Module.imports/exports. |

### Tier B: strong value, moderate effort

| Format | Library | Licence | Cap | Weight | Notes |
|---|---|---|---|---|---|
| 3D: STL / OBJ / PLY / glTF / GLB | three.js loaders | MIT | View + inspect, limited re-export | Pure JS/WebGL | glTF/GLB is the "gold" path (PBR, animation). STL/OBJ are the 3D-printing and interchange staples. FBX loader is flaky (proprietary); treat as best-effort. |
| MOBI / AZW3 + FB2 ebooks | foliate-js | MIT | View | Pure JS | One library also covers EPUB, FB2, CBZ, so it could consolidate our ebook story. DRM-free only. Author warns API is unstable; pin a commit. |
| 7z / RAR / bzip2 / xz / zstd archives | archive-wasm (or libarchive.js) | BSD-2 core | Extract (create for non-RAR) | ~1-2 MB WASM | One umbrella extractor for the whole archive family instead of five libs. Extends the archive viewer we already have. RAR is extract-only everywhere. |
| Parquet | hyparquet (+ hyparquet-writer, hyparquet-compressors) | MIT | Read + write | Pure JS, ~10 KB core | Dramatically lighter than the WASM options. Read into the grid, edit, export. |
| Arrow / Feather | apache-arrow (JS) | Apache-2.0 | Read + write | Pure JS | Official. Pairs with the grid. |
| Avro | avsc | MIT | Read + write | Pure JS | May need the avsc-browser shim for Node built-ins. |
| Protobuf (with schema) | protobuf.js | BSD-3 | Read + write when a .proto is supplied | Small | Schemaless files: only a best-effort wire-format walk (field numbers + wire types); names and exact types are unrecoverable without the schema, that is inherent. |
| HEIC / HEIF (iPhone photos) | libheif-js | LGPL-3.0 | View | ~1-3 MB WASM | Huge consumer volume (iPhone default since 2017). LGPL is the consideration; no permissive full HEIC decoder exists. Ship unmodified, document attribution. |

### Tier C: niche or heavy, do opportunistically

| Format | Library | Licence | Cap | Weight | Notes |
|---|---|---|---|---|---|
| Camera RAW (CR2/NEF/ARW/DNG) | LibRaw-Wasm | CDDL (triple-licensed; pick CDDL) | View | Multi-MB WASM + worker | Cheap path first: extract the embedded full-res JPEG preview (via UTIF) for instant display, full demosaic on demand. |
| DICOM .dcm | Cornerstone3D, or dicom-parser alone | MIT | View | Moderate WASM | Best licence of the medical/CAD group. Start with dicom-parser for metadata + simple frames, add the image loader for compressed transfer syntaxes. |
| DXF (2D CAD) | dxf-viewer / dxf-parser | MPL-2.0 / MIT | View | Pure JS | Clean. DWG and STEP are the harder siblings (see section 4). |
| STEP (CAD) | occt-import-js | LGPL-2.1 | View (tessellated) | Multi-MB WASM | OpenCASCADE to meshes fed into three.js. Lazy-load. |

## 3. Sequencing recommendation

The cheapest, highest-value first swing, mostly small pure-JS libraries that slot into
the existing format/editor module pattern:

1. Fonts (opentype.js): closes the only tier-1 gap; a glyph specimen plus metadata edit
   is a satisfying, self-contained editor.
2. SQLite (sql.js): high developer value, reuses the grid, matches the export-file flow.
3. .ics / .vcf (ical.js): two ubiquitous PIM formats from one small library, round-trip.
4. .eml / .msg (postal-mime, msgreader): saved-email viewing, common in support/legal.
5. .ipynb (notebookjs + our editors): big in data science, and it is just JSON.
6. TIFF, .torrent, .plist, .wasm: each a small self-contained viewer, batchable.

Then tier B as appetite allows: 3D viewer (three.js) is the most crowd-pleasing;
foliate-js could both add MOBI/FB2 and unify the ebook path; the archive-wasm umbrella
extends the archive viewer; Parquet/Arrow/Avro round out the data story.

Note on effort shape: the tier-A items are almost all "parse to a model, render, splice
back" which is exactly the Format + Editor pattern already in place, so most are a
descriptor plus a thin impl adapter, like the recent PSD/AI viewers. sql.js and the 3D
viewer need a bit more UI (a table browser, a WebGL canvas with orbit controls).

## 4. Licence hazards and dead ends

Be explicit about these so we do not sink time into a blocked path:

- ODP (OpenDocument Presentation): the only engine that renders/edits ODF presentations
  client-side is WebODF, which is AGPL-3.0, the same reason it was rejected for richdoc.
  No permissive library renders ODP. Option: build a minimal slide renderer ourselves
  (fflate to unzip, parse the presentation XML, render draw:page slides to HTML/SVG),
  the same architecture as richdoc/sheetedit. Real work, but the only clean route. We
  already do odt/ods, so odp is the missing third of the ODF trio.
- Binary .doc and .ppt (pre-2007 OLE): no viable browser library exists; only server
  tools (antiword, LibreOffice) handle them, with no browser-ready WASM build. The OLE
  container is parseable (SheetJS cfb) but that yields raw streams, not a document
  model. Recommend leaving these unsupported, or text-extraction-only at best. Note
  legacy .xls is already covered via SheetJS.
- Apple iWork (.pages/.numbers/.key): modern iWork is a non-standard-Snappy plus
  Protobuf container with Apple's undocumented schema. Only Python/Go reverse-engineered
  tools exist. A browser port is a large, fragile, best-effort-read-only project.
  Recommend: unsupported (users export to DOCX/PDF anyway).
- DWG (AutoCAD): only LibreDWG can parse it in-browser (libredwg-web WASM), and it is
  GPL-3.0, which would pull the whole app toward GPL. No permissive alternative (the
  format is proprietary). If wanted, isolate as a separately-licensed optional plugin.
- DjVu: only DjVu.js can decode it in-browser, and the core library is GPLv2. Same
  contamination concern. Isolate or defer.

For the LGPL/CDDL/MPL items (HEIC, RAW, STEP, .ics/.vcf), consuming the library
unmodified as a bundled artifact is fine for an MIT app; we just keep them as separate
files and carry their attribution.

## 5. What this does not change

- The privacy model holds for every recommendation: all of these run in the browser, no
  file contents leave the device. WASM size is a load-time concern (lazy-load per
  format, as we already do), not a privacy one.
- Nothing here regresses existing coverage; each is an additive Format + Editor pair.
- "Nothing fails to open" still holds: any new format we do not add still lands in the
  text or hex fallback.

## Sources

Usage data: W3Techs image-format overview (2026-07), HTTP Archive Web Almanac 2025
(fonts), Stack Overflow Developer Survey 2025 (databases), PDF Association / iText
(PDF prevalence), ONLYOFFICE and Collabora (office formats), Reedsy and Wikipedia
(ebook formats), JetBrains Datalore (Jupyter growth).

Libraries: opentype.js, wawoff2, sql.js, @sqlite.org/sqlite-wasm, notebookjs,
ipynb2html, ical.js, postal-mime, @kenjiuno/msgreader, UTIF.js, @ctrl/torrent-file,
plist (npm), wabt, three.js loaders, foliate-js, archive-wasm, libarchive.js,
hyparquet, apache-arrow, avsc, protobuf.js, libheif-js, LibRaw-Wasm, Cornerstone3D /
dicom-parser, dxf-viewer, occt-import-js. Hazards: WebODF (AGPL), libredwg-web (GPL),
DjVu.js (GPL).
