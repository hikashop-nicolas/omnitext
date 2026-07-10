import type { FormatDescriptor } from "../core/types";

// Shapefile (.shp): binary geospatial vector data. Opened read-only on the map via the
// geoeditor, which parses it with shpjs. A bare .shp carries geometry (its .dbf
// attributes are absent when opened alone). Zipped shapefiles open in the archive viewer;
// extract the .shp to view it here.
export const shpFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "shp",
    extensions: [".shp"],
    mimeTypes: ["application/vnd.shp", "x-gis/x-shapefile"],
    binary: true,
    nativeEditor: "geoeditor",
    defaultEditor: "geoeditor",
    soleEditor: true,
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./shp.impl").then((m) => m.shpImpl),
};
