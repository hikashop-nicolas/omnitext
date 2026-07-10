import type { EditorDescriptor } from "../core/types";

// Read-only font viewer: renders a specimen, name/metadata table and a glyph grid via
// opentype.js (TTF/OTF/WOFF). Editing font tables is out of scope.
export const fontViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "fontviewer", consumesViews: ["font"], readOnly: true },
  load: () => import("./fontviewer.impl").then((m) => m.fontViewer),
};
