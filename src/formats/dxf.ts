import type { FormatDescriptor } from "../core/types";

// DXF drawings (.dxf, AutoCAD interchange): opened read-only in the 2D CAD viewer
// (dxf-viewer). Fed as bytes so both ASCII and binary DXF round-trip to the renderer.
export const dxfFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "dxf",
    extensions: [".dxf"],
    mimeTypes: ["image/vnd.dxf", "application/dxf"],
    binary: true,
    nativeEditor: "dxfviewer",
    defaultEditor: "dxfviewer",
    soleEditor: true,
  },
  detect: () => 0, // routed by extension
  load: () => import("./dxf.impl").then((m) => m.dxfImpl),
};
