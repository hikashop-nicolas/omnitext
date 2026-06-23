# Open anything: all text formats, LaTeX, and non-text viewers

## Goal

Make Omnitext open *any* file with the best available surface, since a WebView can
preview most things:

1. **All text** types highlight in CodeMirror (the ~350-400 in
   fileinfo.com/filetypes/text), with a universal plain-text fallback so truly
   unknown extensions still open.
2. **LaTeX**: edit + highlight now, live preview next.
3. **Non-text viewers**: images (`<img>`), audio/video (`<video>`/`<audio>`),
   archives (zip entry list + open-entry + extract), and a generic binary fallback.

All additive; keeps the privacy / client-side / static-hosted / MIT model. Non-text
surfaces are read-only **viewers**: in read-only mode the **Save button is hidden**
(and the dirty dot suppressed), rather than offering a no-op Save. This is driven by
a `readOnly` flag on the editor manifest (the existing Preview editor sets it too);
main.ts hides `#btn-save` / `#dirty` when the active editor is read-only and shows
them again for editable ones.

## How formats work today (the cost of adding one)

A format is a tiny descriptor + a lazy impl:

```ts
// xxx.ts
export const xxxFormat: FormatDescriptor = {
  manifest: { kind: "format", id: "xxx", extensions: [".xxx"],
              mimeTypes: ["text/xxx"], nativeEditor: "codemirror" },
  detect() { return 0; },
  load: () => import("./xxx.impl").then((m) => m.xxxImpl),
};
// xxx.impl.ts  (parse/serialize are identity for text; language() is optional)
export const xxxImpl: FormatModule = {
  parse: (t) => ({ ok: true, model: t, diagnostics: [] }),
  serialize: (m) => String(m),
  language: () => StreamLanguage.define(someLegacyMode), // or omit for plain text
};
```

Two facts that make expansion cheap and safe:

- **Unknown text already works.** An unrecognised extension decodes as text and
  opens in CodeMirror (plain, fully editable). So this work is about *recognition*
  (correct Format label, "Open with" MIME, New-dialog entry) and *highlighting*,
  not about making files openable - they already open.
- **103 highlighting modes are already installed** via `@codemirror/legacy-modes`
  (confirmed: `clike`, `rust`, `go`, `ruby`, `perl`, `lua`, `haskell`, `swift`,
  `scala`, `r`, `julia`, `fortran`, `cobol`, `pascal`, `tcl`, `erlang`, `clojure`,
  `scheme`, `commonlisp`, `powershell`, `dockerfile`, `nginx`, `toml`, `properties`,
  `diff`, `stex` (LaTeX), `textile`, `gas`, `cmake`, `puppet`, `protobuf`, ...),
  plus the existing `@codemirror/lang-*` (js/ts, json, css, html, xml, yaml,
  python, sql, markdown). No new dependencies needed for the bulk.

## Part A - format expansion (cheap, low risk)

Add descriptors in batches, grouped by category. Each is ~6 lines + a one-line
impl. Highlight via legacy-modes where a mode exists; omit `language()` (plain
CodeMirror) for the rest.

Proposed batches (representative, not exhaustive):

- **Source code (legacy `clike` + dedicated modes):** C/C++/h (`clike`), C#
  (`clike`), Java (`clike`), Kotlin, Objective-C (`clike`), Go, Rust, Ruby, Perl,
  Lua, Haskell, Swift, Scala, R, Julia, Dart, Elixir/Erlang, Clojure, Scheme/Lisp,
  F#/OCaml (`mllike`), Fortran, COBOL, Pascal/Delphi, Tcl, Groovy, PowerShell,
  Visual Basic, Assembly (`gas`), Solidity, GraphQL.
  - PHP needs `@codemirror/lang-php` (1 small dep) - add if wanted; otherwise it
    opens as plain text.
- **Markup / docs:** LaTeX `.tex/.ltx/.sty/.cls` (`stex`), reStructuredText
  `.rst`, AsciiDoc `.adoc`, Org `.org`, Textile `.textile`, BibTeX `.bib`,
  Wiki/Creole, man pages `.man`/`.troff` (`troff`), SGML `.sgml`.
- **Config / data:** `.env` variants, `.editorconfig`, `.gitignore`/`.gitattributes`,
  Dockerfile, `nginx.conf`, Apache, `Makefile`/`.mk` (`cmake` for CMake),
  `.desktop`, `.reg`, `.plist` (xml), `.proto`, `.graphql`, `.tf` (HCL - plain or
  a mode), `.tsv`/`.tab`, `.ndjson`/`.jsonl`, `.har` (json).
- **Logs / plain:** `.log`, `.err`, `.txt`/`.text`, `.nfo`, `.me`, `.readme`,
  `.diff`/`.patch` (`diff`), `.srt`/`.vtt` (subtitles - plain for now).

Mechanics:
- Keep one impl file per *highlighting mode* and reuse it across extensions where
  it makes sense, to avoid 200 near-identical files. Likely a small
  `codemirror-formats.ts` table: `[{ id, exts, mimes, mode }]` generating the
  descriptors in a loop, with a couple of bespoke ones kept separate.
- Update the Android "Open with" intent-filter MIME list and the New-dialog list
  to include the new text types.
- A golden test: every descriptor's extensions resolve to it; `language()` (when
  present) constructs without throwing.

Scope: go **comprehensive**, not curated. A compact data table (ext -> mode) makes
"all of fileinfo's text list" about as cheap as a subset, and the universal
plain-text fallback covers whatever is still missing, so the result is literally
"every text file opens, most are highlighted."

## Part B - LaTeX

### Findings on SwiftLaTeX (the suggested base) - recommend AGAINST forking it

Three independent dealbreakers, each fatal for Omnitext:

1. **License: AGPL-3.0.** Omnitext and all its editor libraries are MIT. AGPL is
   copyleft *with a network-use clause*; bundling SwiftLaTeX's editor code into a
   site served over the network would force the whole app under AGPL and mandate
   source disclosure under AGPL terms. Incompatible with the project's MIT model.
2. **Unmaintained.** Last release Feb 2022, 57 commits; the user already noticed
   the demo is broken. A fork means owning a dormant WASM TeX toolchain.
3. **Not actually offline / not private.** It fetches packages on demand from a
   TeX Live package server (texlive.swiftlatex.com / CTAN). That reintroduces a
   backend and sends the document's package needs off-device - the opposite of
   Omnitext's privacy story. Self-hosting the server is a backend we do not run.

`TeXlyre` (the modern successor that wraps SwiftLaTeX + BusyTeX / TeX Live 2026)
is **also AGPL-3.0**, still uses download servers, and is tightly coupled to a
React app (no reusable compile library). Same verdict.

Bottom line: a fully client-side, offline, MIT-compatible LaTeX-to-PDF compiler of
*arbitrary* documents with *arbitrary packages* does not exist today. The real TeX
engines are GPL/AGPL and depend on a package archive. We should not pretend
otherwise.

### Recommended LaTeX path (fits Omnitext exactly)

- **Now (free): edit + highlight.** Register `.tex/.latex/.ltx/.sty/.cls/.bib`
  formats on CodeMirror with the already-installed `stex` mode. This alone makes
  Omnitext "support LaTeX files" (open, highlight, edit, save) - covers the most
  common need.
- **Next: live HTML preview via LaTeX.js** (`latex.js`, **MIT**, pure JS, no WASM,
  no server, runs fully in the browser; npm `latex.js`; last release Apr 2023,
  stable). It translates a large, faithful subset of LaTeX to HTML5 (think "marked,
  for LaTeX"). Wire it as a **Preview view for .tex** (CodeMirror/stex stays the
  default editor; preview is the alternative view). Math uses KaTeX-class fonts.
  SIZE: the JS is ~580 KB; ship **woff2 fonts only** (~315 KB) and drop the legacy
  .woff/.ttf triplicates (7.7 MB) the npm package also carries. Total ~1 MB, lazy.
  Render into a shadow root with the latex.js CSS so styles do not leak and the
  font URLs resolve against our origin. Be explicit about limits: it is a subset
  (no arbitrary package compilation, no PDF), so complex documents may render
  partially.
- **PDF export of the preview (optional):** the rendered HTML can go through the
  existing jsPDF/print path for a rough PDF; not true TeX typesetting, but
  client-side and honest about fidelity.

## Part D - SVG vector editor (svgedit)

SVG is the one image type that is also text, so it deserves real editing, not just a
preview. **svgedit** (github.com/svg-edit/svgedit) is a good fit: **MIT**, actively
maintained (v7.3.3, Dec 2023, 4000+ commits), on npm (`svgedit`, plus the
UI-less engine `@svgedit/svgcanvas`), fully client-side, and it loads/round-trips
real `.svg` files in a WYSIWYG vector canvas.

SIZE is fine (the FULL `svgedit` is 38 MB unpacked and rejected; `@svgedit/svgcanvas`
bundles to ~1.1 MB), but the EMBED is the catch (found while scoping): bare
`@svgedit/svgcanvas` ships a single minified CJS bundle with no documented
standalone-embed path. Its constructor takes a large config object normally supplied
by the full svgedit Editor (wiring it by hand means reverse-engineering that), and the
full Editor fetches locale/extension assets at runtime, which is awkward in a bundled
static app. So a real SVG vector editor is a FOCUSED mini-project, best as a small
standalone wrapper library (like pdfedit/sheetedit) that nails the svgcanvas embed once
and exposes a clean API; Omnitext then consumes it as a git dependency.

Two paths to choose between:
- **(D1a) Full vector editor**: build that svgcanvas wrapper lib. `.svg` becomes a text
  format whose defaultEditor is the vector editor, with CodeMirror (XML) as the
  alternative; getText returns serialized SVG. Bigger effort, the real WYSIWYG goal.
- **(D1b) Lighter now**: keep `.svg` as editable XML text and add a live rendered SVG
  preview view (reuse the preview pattern; render via <img>/inline). Cheap; gives
  see-and-edit without vector tools. Can precede D1a.

### Optional future: Typst, the clean "real typesetting" path

If the goal is genuine, fully client-side document compilation with real PDF/SVG
output, **Typst** is the license- and offline-clean option the LaTeX world lacks:
`typst.ts` (Myriad-Dreamin) runs the **Apache-2.0** Typst compiler in WASM, fully
offline, emitting PDF and SVG. It is *Typst* syntax, not LaTeX, so it is a
*separate* format/editor (`.typ`), not a LaTeX backend - but it would give
Omnitext a true, private, in-browser typeset-to-PDF story. Worth a later phase if
wanted; not a substitute for LaTeX support.

## Part C - non-text viewers (read-only)

The core already supports binary formats (`manifest.binary`, `parseBinary`,
editor `getBytes`, the read-only Preview editor). Add viewer editors + binary
format routing. Route by **MIME class** (file.type on web, the intent MIME on
Android) so "all images / all video / all audio" is covered without enumerating
every codec, with extension fallback.

- **Image viewer** (`image/*`, incl. `.png .jpg .gif .webp .avif .bmp .ico`):
  `<img>` from a blob URL; click toggles fit-to-width vs actual size. Read-only.
  SVG is NOT here (it is editable text/XML; see the SVG vector editor below).
- **Media viewer** (`audio/*`, `video/*`: `.mp4 .webm .ogg .mov(?) .mp3 .wav
  .m4a ...`): HTML5 `<video controls>` / `<audio controls>` from a blob/served
  URL. Codec support is whatever the platform WebView provides (mp4/h264, webm,
  mp3, wav, ogg are safe; show a clear "format not supported by this browser"
  fallback otherwise).
- **Archive viewer** (`.zip` and zip-based `.jar`; gzip/tar later): list entries
  (path, size) with **fflate** (MIT, ~the lib the editor libraries already use).
  Per entry: **Open** (route its bytes back through the open flow -> the right
  editor/viewer, so you can browse a zip and edit a JSON inside it) and
  **Extract** (save/share that entry). "Extract all" to a folder where
  `showDirectoryPicker` exists (Chromium desktop).
- **Generic binary fallback**: for anything else, a small info view (name, size,
  MIME) + Download/Share, and a hex view for small files. So nothing ever fails
  to open.

DONE: zip/jar/cbz + tar/tgz/tar.gz + transparent .gz, all via fflate + a small
USTAR codec (src/core/tar.ts, src/core/archive.ts), with browse + open-entry +
extract + edit-and-save-back.

7z/rar/xz/bzip2/zstd/cab (evaluated 2026-06-23, DEFERRED - "not now"):
- 7zip-min: rejected, Node-only (spawns the native 7za binary; no browser/WebView).
- JS7z (github GMH-Code/JS7z, npm js7z-tools): a WASM 7-Zip, the viable path. wasm
  is ~1.5MB (~550KB gz), lazy. The npm build is MULTI-THREADED (pthreads +
  SharedArrayBuffer) so it needs COOP/COEP, which GitHub Pages cannot set; the
  SINGLE-THREADED build (ST_MODE=1) works on Pages and would be vendored like the
  latex/svgedit assets. License: 7-Zip LGPL+BSD, rar via the unRAR license
  (extract-only) - the first non-MIT dep, permissive but adds notices. API:
  Emscripten (write to FS, callMain(['x'|'l', ...]), read FS back), async.
  Write-back only for 7-Zip-creatable formats (7z/xz/bz2), not rar/cab. Revisit
  on demand.

### Plumbing this needs

- **Don't read big media into memory.** Today the open path does
  `file.arrayBuffer()` immediately. Keep the `File`/`Blob` and hand media viewers
  a `URL.createObjectURL(file)` instead of bytes. On Android (where "Open with"
  arrives as bytes from the native plugin) large media is the weak spot: have the
  plugin copy the content to cache and return a path, then `Capacitor.convertFileSrc`
  gives a WebView-loadable URL for `<video>`/`<img>` (avoids base64-ing a 500 MB
  file). Small files keep the current bytes path.
- Add `fflate` to omnitext (only the archive viewer needs it; lazy-loaded).

### The one honest limitation: "extract next to the file"

Extracting *into a sibling folder of the source file* is not generally possible:
- Web: a file handle does not expose its parent directory (File System Access has
  no "parent of this file"); the realistic options are extract-to-a-folder-you-pick
  (`showDirectoryPicker`, Chromium only) or per-entry Save.
- Android: scoped storage gives no writable sibling of a `content://` file;
  extraction goes through the SAF "pick a destination" flow or Share.
So the archive viewer ships as **list + open-entry + extract (Save/Share, or
extract-all to a chosen folder where supported)**, not silent extract-next-to-file.

## Phasing

1. **A1**: the codemirror-formats table covering all of fileinfo's text list
   (incl. `.tex` highlighting) + universal plain-text fallback, New-dialog +
   Android MIME updates, tests. Low risk, ship first.
2. **C1**: image viewer + media viewer (MIME-class routing; blob-URL plumbing).
3. **C2**: archive (zip) viewer (entries + open-entry + extract) via fflate.
4. **B1**: LaTeX.js preview view for `.tex` (+ the limits note in the UI).
5. **C3** (optional): generic binary/hex fallback.
6. **D1**: SVG vector editor via svgedit (.svg = vector by default, XML text as the
   alternative view).
7. **B2 / A2** (optional): Typst editor (`typst.ts`, real client-side PDF/SVG);
   a few dedicated `@codemirror/lang-*` packages where the fallback looks weak.

## Risks / decisions to confirm

- Non-text surfaces are **read-only viewers** (no editing of pixels/video/audio);
  the Save button + dirty dot are hidden in read-only mode. Confirm that is
  acceptable (it is the realistic browser scope).
- Archive "extract next to the file" is not generally possible (see above); ship
  list + open-entry + extract-to-chosen-folder/Share instead.
- Large media on Android needs the cache-copy + convertFileSrc path to avoid
  base64-ing huge files; small files use the existing bytes path.
- Video/audio codec coverage = whatever the platform WebView supports; show a
  graceful "unsupported" message rather than a broken player.
- SVG is rendered via `<img>` (scripts inert) for safety.
- Legacy modes first; add `@codemirror/lang-*` deps only where the difference is
  visible.
- LaTeX preview fidelity: LaTeX.js is a subset; say so in the UI, do not imply
  full TeX. Reject SwiftLaTeX/TeXlyre forks (AGPL + package server + unmaintained).
