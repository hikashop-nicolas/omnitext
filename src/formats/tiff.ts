import type { FormatDescriptor } from "../core/types";

// TIFF images (.tif/.tiff): binary, multi-page, opened read-only in the TIFF viewer
// (UTIF.js). TIFF starts with "II*\0" (little-endian) or "MM\0*" (big-endian).
export const tiffFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "tiff",
    extensions: [".tif", ".tiff"],
    mimeTypes: ["image/tiff"],
    binary: true,
    nativeEditor: "tiffviewer",
    defaultEditor: "tiffviewer",
    soleEditor: true,
  },
  detect: ({ sample }) => (sample.startsWith("II*") || sample.startsWith("MM\0*") ? 1 : 0),
  load: () => import("./tiff.impl").then((m) => m.tiffImpl),
};
