import type { FormatDescriptor } from "../core/types";

// Font files (.ttf/.otf/.woff): binary, opened read-only in the font viewer, which
// renders a specimen, metadata and a glyph grid via opentype.js. WOFF2 is Brotli-
// compressed and needs a separate decompressor, so it is not routed here.
export const fontFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "font",
    extensions: [".ttf", ".otf", ".woff"],
    mimeTypes: ["font/ttf", "font/otf", "font/woff", "application/font-sfnt"],
    binary: true,
    nativeEditor: "fontviewer",
    defaultEditor: "fontviewer",
    soleEditor: true,
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./font.impl").then((m) => m.fontImpl),
};
