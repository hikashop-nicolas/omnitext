import type { FormatDescriptor } from "../core/types";

// GeoJSON: JSON text whose default surface is the GeoJS map (geoeditor). The raw JSON
// stays available via the CodeMirror text view. Model === text (identity round-trip).
export const geojsonFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "geojson",
    extensions: [".geojson"],
    mimeTypes: ["application/geo+json"],
    nativeEditor: "geoeditor",
    defaultEditor: "geoeditor",
    soleEditor: true,
  },
  // Only claim a .json file when it clearly is GeoJSON, so ordinary JSON keeps its
  // code/tree editor. The .geojson extension routes here without this sniff.
  detect({ sample }) {
    return /"(?:FeatureCollection|Feature|Point|LineString|Polygon|MultiPolygon)"/.test(sample)
      ? 0.7
      : 0;
  },
  load: () => import("./geojson.impl").then((m) => m.geojsonImpl),
};
