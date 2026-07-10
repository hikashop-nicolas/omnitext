import type { FormatDescriptor } from "../core/types";

// Camera RAW files: opened read-only in the RAW viewer (embedded preview + EXIF). Routed
// by extension because most RAW formats are TIFF-based and share magic bytes.
export const rawFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "raw",
    extensions: [
      ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".dng", ".rw2",
      ".orf", ".raf", ".pef", ".srw", ".rwl", ".3fr", ".erf", ".mrw",
    ],
    mimeTypes: ["image/x-dcraw", "image/x-adobe-dng"],
    binary: true,
    nativeEditor: "rawviewer",
    defaultEditor: "rawviewer",
    soleEditor: true,
  },
  detect: () => 0, // routed by extension
  load: () => import("./raw.impl").then((m) => m.rawImpl),
};
