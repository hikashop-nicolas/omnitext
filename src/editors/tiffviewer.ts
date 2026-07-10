import type { EditorDescriptor } from "../core/types";

// Read-only multi-page TIFF viewer (UTIF.js). Decodes each page to a canvas.
export const tiffViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "tiffviewer", consumesViews: ["tiff"], readOnly: true },
  load: () => import("./tiffviewer.impl").then((m) => m.tiffViewer),
};
