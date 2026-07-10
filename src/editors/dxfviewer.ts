import type { EditorDescriptor } from "../core/types";

// Read-only 2D CAD viewer for DXF (dxf-viewer, WebGL). Pan/zoom, layer colours.
export const dxfViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "dxfviewer", consumesViews: ["dxf"], readOnly: true },
  load: () => import("./dxfviewer.impl").then((m) => m.dxfViewer),
};
