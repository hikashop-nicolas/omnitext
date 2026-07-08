import type { FormatDescriptor } from "../core/types";

// EPUB books, read-only. Rendered by the epub editor (@intity/epub-js,
// BSD-2-Clause) as a paginated book with prev/next navigation.
export const epubFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "epub",
    extensions: [".epub"],
    mimeTypes: ["application/epub+zip"],
    binary: true,
    nativeEditor: "epub",
  },
  detect: () => 0, // detected by extension
  load: () => import("./bytes.impl").then((m) => m.bytesImpl),
};
