import type { FormatDescriptor } from "../core/types";

// WKT (Well-Known Text): one geometry per line. The geoeditor renders it (converted to
// GeoJSON) as a read-only map; export it as GeoJSON/KML/GPX to edit.
const WKT_RE = /^\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*[ZM]*\s*[(]/i;

export const wktFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "wkt",
    extensions: [".wkt"],
    mimeTypes: ["text/plain"],
    nativeEditor: "geoeditor",
    defaultEditor: "geoeditor",
    soleEditor: true,
  },
  detect({ sample }) {
    return WKT_RE.test(sample) ? 0.75 : 0;
  },
  load: () => import("./wkt.impl").then((m) => m.wktImpl),
};
