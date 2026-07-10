import type { FormatDescriptor } from "../core/types";

// GPX: XML text (GPS tracks/waypoints/routes) whose default surface is the GeoJS map
// (geoeditor); the raw XML stays available via the CodeMirror text view.
export const gpxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "gpx",
    extensions: [".gpx"],
    mimeTypes: ["application/gpx+xml"],
    nativeEditor: "geoeditor",
    defaultEditor: "geoeditor",
    soleEditor: true,
  },
  detect({ sample }) {
    return /<gpx[\s>]/i.test(sample) ? 0.8 : 0;
  },
  load: () => import("./gpx.impl").then((m) => m.gpxImpl),
};
