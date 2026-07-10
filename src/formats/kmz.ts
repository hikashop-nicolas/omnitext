import type { FormatDescriptor } from "../core/types";

// KMZ: a zip archive containing a KML document (doc.kml) plus assets. Binary; the
// geoeditor unzips it, edits the inner KML on the map, and re-zips on save.
export const kmzFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "kmz",
    extensions: [".kmz"],
    mimeTypes: ["application/vnd.google-earth.kmz"],
    binary: true,
    nativeEditor: "geoeditor",
    defaultEditor: "geoeditor",
    soleEditor: true,
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./kmz.impl").then((m) => m.kmzImpl),
};
