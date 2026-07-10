import type { FormatDescriptor } from "../core/types";

// HEIC/HEIF images (.heic/.heif, iPhone photos): binary ISOBMFF, opened read-only in the
// HEIC viewer (libheif-js). The container has an "ftyp" box with a heic-family brand.
export const heicFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "heic",
    extensions: [".heic", ".heif", ".hif"],
    mimeTypes: ["image/heic", "image/heif"],
    binary: true,
    nativeEditor: "heicviewer",
    defaultEditor: "heicviewer",
    soleEditor: true,
  },
  detect: ({ sample }) =>
    sample.includes("ftyp") && /(heic|heix|heim|heis|hevc|mif1|msf1)/.test(sample.slice(0, 32)) ? 1 : 0,
  load: () => import("./heic.impl").then((m) => m.heicImpl),
};
