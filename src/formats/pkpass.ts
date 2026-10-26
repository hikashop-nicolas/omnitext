import type { FormatDescriptor } from "../core/types";

// Apple Wallet passes (.pkpass, and .pkpasses bundles): zip files, opened read-only in the
// wallet viewer.
export const pkpassFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "pkpass",
    extensions: [".pkpass", ".pkpasses"],
    mimeTypes: ["application/vnd.apple.pkpass", "application/vnd.apple.pkpasses"],
    binary: true,
    nativeEditor: "walletviewer",
    defaultEditor: "walletviewer",
    soleEditor: true,
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./pkpass.impl").then((m) => m.pkpassImpl),
};
