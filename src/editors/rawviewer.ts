import type { EditorDescriptor } from "../core/types";

// Read-only camera RAW viewer: embedded JPEG preview + EXIF metadata (exifr).
export const rawViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "rawviewer", consumesViews: ["raw"], readOnly: true },
  load: () => import("./rawviewer.impl").then((m) => m.rawViewer),
};
