# Geospatial editor: enhancement program

> STATUS: Phases A–J all shipped and verified (145 unit tests + browser smoke tests).
> Deferred by design: Shapefile, GeoPackage, full GPX track/route vertex editing,
> KML NetworkLink/GroundOverlay (see Phase J rationale).


Builds on the shipped GeoJS editor (view + add/delete/rename features, byte-lossless
edits, OSM basemap, interactive-only). This plan closes the gaps found in review, in
priority order. Each phase ships independently, keeps edits byte-lossless where the
existing code is, and is verified with unit tests + a browser smoke test.

Shared conventions: pure edit logic lives in `src/editors/geo/*.ts` (unit-tested,
GeoJS/DOM-free); the editor (`geoeditor.impl.ts`) wires UI to it. GeoJSON edits go
through jsonc-parser; KML/GPX through the positional `xml-source.ts` splicer.

## Phase A — Edit existing geometry (highest value)

Let the user reshape/move existing features, not just add/delete. Reuse the GeoJS
annotation layer in edit mode.

- Panel gets an "Edit shape" action. On click: build a GeoJS annotation from the
  clicked feature's geometry, put the layer in edit mode, show Done/Cancel.
- On Done, read the annotation's new coordinates and splice them into the source:
  - GeoJSON: jsonc-parser replaces `features[i].geometry.coordinates`.
  - KML: replace the feature's `<coordinates>` content span(s) (extend `xml-source`
    to record them). Point/LineString/Polygon(outer ring).
  - GPX: move a `wpt` by replacing its `lat`/`lon` attribute values in the open tag.
- Deferred: GPX `trk`/`rte` vertex editing (attribute-per-point, count changes make
  a lossless splice hard); MultiGeometry parts beyond the first. Panel shows no "Edit
  shape" for those.

## Phase B — Arbitrary properties (GeoJSON)

The panel only edits name/description. Add full property editing for GeoJSON:

- Add-property row (key + value), delete-property (×) per row, rename not required
  (delete + re-add). All via jsonc-parser (`['features', i, 'properties', key]`,
  value `undefined` to remove).
- KML/GPX stay name/description (their arbitrary data is ExtendedData/extensions,
  out of scope this phase).

## Phase C — Styling: display + edit

Features render in one default style today; the file's own styling is invisible.

- Display: apply per-feature style when present — GeoJSON simplestyle-spec
  (`marker-color`, `stroke`, `stroke-width`, `fill`, `fill-opacity`); KML `<Style>`/
  `<styleUrl>` colors (read via togeojson, which surfaces some as properties, plus a
  light `<Style>` scan for icon/line/poly color).
- Edit: a color control in the panel writing simplestyle keys for GeoJSON. KML style
  editing is display-only this phase (writing `<Style>` losslessly is a later step).

## Phase D — Feature list / search panel

A side panel (`host.ui.openPanel`) listing every feature: name (or `#index` +
geometry type), filter box, click to select + zoom-to, and a delete affordance.
Makes large files navigable. Selecting highlights the feature and opens its props.

## Phase E — Map labels

Toggle (toolbar icon) to draw feature names as labels on the map (GeoJS text
feature). Off by default; state per-session.

## Phase F — KMZ

`.kmz` is a zip containing `doc.kml`. Detect it (binary/zip), unzip via the existing
archive path (fflate), edit the inner KML with the normal KML pipeline, and re-zip on
save. Round-trips the other zip entries untouched.

## Phase G — Touch / mobile

`hammerjs` was never installed, so GeoJS multitouch (pinch-zoom, touch drawing) is
degraded, and this ships as an Android app. Install `hammerjs`, ensure GeoJS picks it
up, verify pan/zoom/draw on a touch surface.

## Phase H — Conversion / export

The map model makes format conversion nearly free. A panel/command to export the
current document as GeoJSON / KML / GPX (whichever it isn't), reusing the geometry
serializers. Emitted as a downloadable/shareable file (not a lossless in-place edit,
so it's an export, not a Save).

## Phase I — Robustness

- Byte-lossless GeoJSON add/delete/coord edits: replace the jsonc-array reindent with
  targeted text splices so untouched bytes are preserved (parity with KML/GPX).
- CDATA-safe field edits (don't clobber `<![CDATA[...]]>` structure when replacing
  content; detect and preserve the wrapper).
- Incremental render: avoid re-fitting bounds on every edit (only on open); keep the
  full re-read but never move the viewport after the first fit.
- Preserve altitude in KML coordinates when a vertex count is unchanged.

## Phase J — More formats (lighter)

- TopoJSON: read + render (via `topojson-client` → GeoJSON) and edit through a GeoJSON
  conversion, or render-only if lossless edit is impractical.
- WKT: read/render small geometries (`wellknown`), export.
- Deferred with rationale: Shapefile (binary, no clean in-browser lossless write),
  GeoPackage (SQLite), KML NetworkLink/GroundOverlay. These are import/export-only at
  best and don't fit the "edit the file in place" model; revisit only on demand.

## Order of work

A → B → C → D → E → F → G → H → I → J, shipping and verifying each before the next.
Quick wins (G, E) may be pulled forward opportunistically.
