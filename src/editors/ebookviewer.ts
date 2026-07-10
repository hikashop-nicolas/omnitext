import type { EditorDescriptor } from "../core/types";

// Read-only ebook viewer for MOBI/AZW3/FB2 (foliate-js). EPUB uses the epub viewer.
export const ebookViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "ebookviewer", consumesViews: ["ebook"], readOnly: true },
  load: () => import("./ebookviewer.impl").then((m) => m.ebookViewer),
};
