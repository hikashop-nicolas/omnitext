import type { FormatDescriptor } from "../core/types";

// TopoJSON: a topology-encoded GeoJSON variant. The geoeditor renders it (converted to
// GeoJSON via topojson-client) as a read-only map; export it as GeoJSON/KML/GPX to edit.
export const topojsonFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "topojson",
    extensions: [".topojson"],
    mimeTypes: ["application/json"],
    nativeEditor: "geoeditor",
    defaultEditor: "geoeditor",
    soleEditor: true,
  },
  detect({ sample }) {
    return /"type"\s*:\s*"Topology"/.test(sample) ? 0.85 : 0;
  },
  load: () => import("./topojson.impl").then((m) => m.topojsonImpl),
};
