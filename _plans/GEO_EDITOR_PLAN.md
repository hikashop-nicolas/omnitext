# Geospatial map editor (GeoJS) for KML / GeoJSON / GPX

## Goal

Open a geospatial file (KML, GeoJSON, GPX) and see its features on an interactive
map instead of raw markup, with editing (move/add/delete features, edit properties).
Editing is **lossless**: it splices the original source in place, so styles, folders,
and metadata survive. The raw text stays available in the CodeMirror view.

This slots into the existing three-module contract with no core changes. It mirrors
the SVG editor exactly: a text format (`src/formats/svg.ts` + `.impl.ts`) whose
`nativeEditor` is a rich canvas surface (`src/editors/svgeditor.ts` + `.impl.ts`),
with CodeMirror as the text fallback. Read those four files before starting.

## Library choice

- **GeoJS** (Kitware, Apache-2.0, npm `geojs`) as the user requested. WebGL feature
  layer scales to large datasets; ships an annotation layer for interactive editing.
  Heavier and less mainstream than the alternatives, but it is lazy-loaded as its own
  chunk (like svgedit, pdf.worker, octopus.wasm) so the base bundle is unaffected.
- **Position-aware parsing** for the lossless source model (see below):
  - `saxes` (ISC): streaming XML parser that reports byte offsets -> lets us record
    the exact source span of every editable element in KML/GPX.
  - `jsonc-parser` (Microsoft, MIT): `modify()` + `applyEdits()` produce minimal text
    edits into a JSON document, preserving formatting and all untouched regions.
  - `@tmcw/togeojson` (ISC): KML/GPX -> GeoJSON, used **only** to feed GeoJS for
    display in Phase 0; it is not the editing model and never round-trips on save.
- Lighter alternative if GeoJS proves awkward: **Leaflet** (BSD-2) + Leaflet.draw.
  ~40 KB, simpler API, but raster-tile centric and weaker on huge feature counts.
  Decision: go with GeoJS per the request; keep Leaflet as the documented fallback.

## Privacy: tiles are fine, file data must stay local

The only hard rule: **the contents of the opened file never leave the browser.** All
parsing, rendering, and editing run client-side. That specifically forbids any remote
geocoding, address lookup, or server-side conversion that would send feature data
out.

Basemap tiles are fine and the basemap defaults **on**. A tile request sends only
tile coordinates (z/x/y) to the tile host, never any file data, so it does not leak
the document. Use OSM raster tiles by default; a settings toggle can disable the
basemap for fully-offline use. Do not pass any file-derived value into a tile URL,
query string, or third-party request.

## Lossless by in-place source editing (not GeoJSON round-trip)

The map editor is **lossless**: styles, folders, ExtendedData, GPX extensions,
comments, and formatting are all preserved. It achieves this the same way docxedit
and sheetedit do, by editing the source document in place and rewriting only the
exact spans the user changed, rather than regenerating the file from a projection.

The working model is the **source text itself**, never a GeoJSON copy. GeoJSON is a
throwaway projection used to draw features on GeoJS; each map feature carries a
back-reference to its source node so edits target the original bytes.

- **KML / GPX (XML).** On open, one `saxes` pass records, for every feature and every
  editable field, the source offset range of its content: `<coordinates>` text, GPX
  `lat`/`lon` attributes and `<ele>`/`<time>`, and `<name>`/`<description>`. Rendering
  geometry comes from this same pass (or from togeojson in Phase 0). An edit becomes a
  text splice `{ from, to, replacement }`; on `getText()` the splices are applied to
  the original string from the end backwards, so **every byte the user did not touch
  is preserved exactly.** Add = insert a freshly generated `<Placemark>`/`<wpt>`
  before the parent's closing tag; delete = remove that element's full source span.
  Untouched siblings, styling, and metadata are never re-serialized.
- **GeoJSON.** Keep the source text; apply edits with `jsonc-parser`'s `modify()` /
  `applyEdits()`, which rewrite only the changed property/coordinate and leave the
  rest of the document's formatting and key order intact.

Because edits are span splices into the original, the map view and the CodeMirror
text view stay byte-consistent when switching between them. Golden fixtures assert:
open -> no-op edit -> `getText()` is byte-identical to the input, for all three
formats; and a single targeted edit changes only the intended span.

The cost of this approach is that geometry extraction + offset tracking for KML/GPX is
hand-written per format (bounded: Point/LineString/Polygon/MultiGeometry for KML;
wpt/rte/trk/trkseg for GPX). That is the price of lossless and is accepted.

## Modules to add

### 1. Editor: `geoeditor`

- `src/editors/geoeditor.ts` (descriptor, ~6 lines like `svgeditor.ts`):
  `manifest: { kind: "editor", id: "geoeditor", consumesViews: ["geo"] }`,
  lazy `load: () => import("./geoeditor.impl").then(m => m.geoEditor)`.
- `src/editors/geoeditor.impl.ts` (`EditorInstance`):
  - `mount(container, ctx)`: read `ctx.text` + `ctx.filename`/`ctx.format` to know the
    source format; convert to a GeoJSON FeatureCollection (togeojson for kml/gpx,
    JSON.parse for geojson); create the GeoJS map, add a feature layer, fit bounds to
    the data; add the annotation layer for editing; store the working GeoJSON.
  - On any annotation/property edit, record a source splice (XML) or a `jsonc-parser`
    edit (GeoJSON) against the original text and call `ctx.onChange()` (drives dirty +
    autosave, same as svgedit's "changed").
  - `getText()`: apply the accumulated splices to the **original source text** (from
    the end backwards for XML; `applyEdits` for GeoJSON), so untouched bytes are
    preserved exactly and the file keeps its original format.
  - `focus()`, `dispose()` (destroy the GeoJS map, remove listeners). No `getBytes`
    (these are text formats). Consider `getState()`/`setState()` later for history.
  - Editing scope for v1: select feature, move/edit vertices via GeoJS annotations,
    delete feature, edit a feature's name/description in a small side form
    (`host.ui.openPanel`). Adding new features is Phase 2.

### 2. Formats

Three descriptors, each modeled on `src/formats/svg.ts`, all pointing
`nativeEditor: "geoeditor"`, `defaultEditor: "geoeditor"`, with a text fallback:

- `src/formats/geojson.ts` + `.impl.ts`: extensions `.geojson`, `.json` is already
  taken by jsonFormat, so rely on content `detect()` sniffing `"type"`/`"Feature
  Collection"`/`"coordinates"` for `.json`; mimes `application/geo+json`. Identity
  text parse/serialize; `language()` = `json()` for the source view.
- `src/formats/kml.ts` + `.impl.ts`: extension `.kml`, mime
  `application/vnd.google-earth.kml+xml`; identity text; `language()` = `xml()`.
  (`.kmz` is a zipped KML: defer, it is a binary/archive case.)
- `src/formats/gpx.ts` + `.impl.ts`: extension `.gpx`, mime `application/gpx+xml`;
  identity text; `language()` = `xml()`.

`detect()` stays lightweight (no heavy import): filename extension + a cheap string
sniff of the sample (`<kml`, `<gpx`, `"FeatureCollection"`).

### 3. Registration (`src/main.ts`)

- `engine.registerEditor(geoEditor)` alongside the other `registerEditor` calls.
- Add `geojsonFormat, kmlFormat, gpxFormat` to the `FORMATS` array.
- Add blank templates in `src/formats/blank-templates.ts` if we want "New GeoJSON".

## Phased roadmap

- **Phase 0 - viewer.** Formats + `geoeditor` that renders features read-only on a
  GeoJS map with the OSM basemap on, fit-to-bounds, click a feature to see its
  properties (geometry via togeojson for display). Ships the headline "see it on a
  map." No editing yet, so no source-splice machinery required.
- **Phase 1 - lossless property editing.** Add the position-aware source model
  (`saxes` offset index for KML/GPX, `jsonc-parser` for GeoJSON). Edit a selected
  feature's name/description; `getText()` is byte-identical except the edited span.
  Basemap on/off toggle persisted in `src/settings.ts`.
- **Phase 2 - lossless geometry editing.** GeoJS annotation layer: move vertices,
  drag points, delete features, draw new point/line/polygon features, each mapped to a
  source splice (edit coordinates in place; insert/remove whole elements for add/
  delete). History via `getState`/`setState` (store the source text + pending splices).
- **Phase 3 (optional).** KMZ (unzip via existing archive path, edit the inner KML,
  re-zip), TopoJSON (`topojson-client` for display; lossless edit deferred).

## Verification

- `dist/` chunk check: confirm GeoJS lands in its own lazy chunk and is absent from
  the entry bundle (like svgedit / pdf.worker today).
- Open a sample `.kml`, `.geojson`, `.gpx`: features appear, bounds fit; the only
  outbound requests are basemap tiles (z/x/y), and no request carries any file data.
- Byte-lossless: open -> no-op -> `getText()` equals the input byte-for-byte for all
  three formats; a single property/geometry edit changes only the intended span (diff
  the before/after text and confirm one hunk); KML styles/folders/ExtendedData and GPX
  extensions survive an edit untouched.
- Switch geo -> text -> geo: the text view shows exactly the spliced source.
- Basemap off (settings): Network tab shows zero tile requests; toggle persists.
- Golden fixtures per format under the test dir, following the existing
  `*.test.ts` pattern (see `src/formats/xlsx.test.ts`, `codemirror-formats.test.ts`).

## Risks / open questions

- **Bundle weight:** GeoJS is large. Mitigated by lazy load; measure the chunk and
  reconsider Leaflet if it is disproportionate to the feature's value.
- **Offset bookkeeping for XML:** the lossless splice model needs correct source
  ranges from `saxes`, including for namespaced/CDATA/entity content. Cover these in
  fixtures; if a field's span can't be resolved reliably, make that field read-only on
  the map (edit it in the text view) rather than risk a bad splice.
- **`.json` collision:** GeoJSON often uses `.json`; resolve by content detection
  confidence, not extension, so ordinary JSON still opens in the code/tree editor.
- **GeoJS API for in-place editing:** confirm the annotation layer emits per-edit
  events we can bridge to `onChange` (the svgedit "changed" analog) before Phase 2.
