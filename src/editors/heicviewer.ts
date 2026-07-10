import type { EditorDescriptor } from "../core/types";

// Read-only HEIC/HEIF viewer (libheif-js, LGPL WASM): decodes the primary image.
export const heicViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "heicviewer", consumesViews: ["heic"], readOnly: true },
  load: () => import("./heicviewer.impl").then((m) => m.heicViewer),
};
