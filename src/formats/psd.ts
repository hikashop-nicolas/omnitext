import type { FormatDescriptor } from "../core/types";

// Photoshop document (.psd/.psb): binary, opened read-only in the PSD viewer, which
// renders the flattened composite and layer tree via @webtoon/psd.
export const psdFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "psd",
    extensions: [".psd", ".psb"],
    mimeTypes: ["image/vnd.adobe.photoshop"],
    binary: true,
    nativeEditor: "psdviewer",
    defaultEditor: "psdviewer",
    soleEditor: true,
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./psd.impl").then((m) => m.psdImpl),
};
