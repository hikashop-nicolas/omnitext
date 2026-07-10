import type { FormatDescriptor } from "../core/types";

// Non-EPUB ebooks (.mobi, .azw/.azw3 Kindle, .fb2 FictionBook): binary, opened read-only
// in the foliate-js ebook viewer. EPUB has its own format/viewer. (.fb2 is XML but is
// routed here as bytes so the paginated reader handles it uniformly; .fb2.zip too.)
export const ebookFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ebook",
    extensions: [".mobi", ".azw", ".azw3", ".fb2", ".fbz"],
    mimeTypes: ["application/x-mobipocket-ebook", "application/x-fictionbook+xml"],
    binary: true,
    nativeEditor: "ebookviewer",
    defaultEditor: "ebookviewer",
    soleEditor: true,
  },
  detect: () => 0, // routed by extension
  load: () => import("./ebook.impl").then((m) => m.ebookImpl),
};
