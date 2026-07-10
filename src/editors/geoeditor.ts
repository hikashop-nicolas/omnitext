import type { EditorDescriptor } from "../core/types";

// Geospatial map surface for KML / GeoJSON / GPX, built on GeoJS. Features draw on an
// optional OSM basemap; GeoJSON feature properties are editable in place (byte-lossless
// via jsonc-parser). KML/GPX map editing lands in a later phase; their raw XML stays
// editable through the CodeMirror text view.
export const geoEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "geoeditor", consumesViews: ["geo"] },
  load: () => import("./geoeditor.impl").then((m) => m.geoEditor),
};
