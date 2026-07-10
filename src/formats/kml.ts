import type { FormatDescriptor } from "../core/types";

// KML: XML text whose default surface is the GeoJS map (geoeditor); the raw XML stays
// available via the CodeMirror text view. Model === text (identity round-trip).
export const kmlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "kml",
    extensions: [".kml"],
    mimeTypes: ["application/vnd.google-earth.kml+xml"],
    nativeEditor: "geoeditor",
    defaultEditor: "geoeditor",
    soleEditor: true,
  },
  detect({ sample }) {
    return /<kml[\s>]/i.test(sample) ? 0.8 : 0;
  },
  load: () => import("./kml.impl").then((m) => m.kmlImpl),
};
