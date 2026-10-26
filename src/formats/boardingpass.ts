import type { FormatDescriptor } from "../core/types";

// A boarding pass barcode string (IATA BCBP, the text inside an airline barcode), saved as a
// text file: rendered by the wallet viewer; raw text editing stays available.
export const boardingPassFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "bcbp",
    extensions: [".bcbp"],
    mimeTypes: [],
    nativeEditor: "walletviewer",
    defaultEditor: "walletviewer",
  },
  // The whole file is the one string: a fixed-width header, so ordinary prose never matches.
  detect: ({ sample }) => (sample.length <= 2000 && /^M[1-4][A-Z0-9 /.'-]{20}[A-Z0-9 ][A-Z0-9]{6} [A-Z]{6}/.test(sample.trim()) ? 0.9 : 0),
  load: () => import("./wallettext.impl").then((m) => m.walletTextImpl),
};
