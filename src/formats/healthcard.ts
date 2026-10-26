import type { FormatDescriptor } from "../core/types";

// SMART Health Cards (.smart-health-card JSON, or the shc:/ text of its QR code): rendered by
// the wallet viewer; raw text editing stays available via the text editor.
export const healthCardFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "healthcard",
    extensions: [".smart-health-card"],
    mimeTypes: ["application/smart-health-card"],
    nativeEditor: "walletviewer",
    defaultEditor: "walletviewer",
  },
  detect: ({ sample }) => (/^\s*shc:\/\d/i.test(sample) || /^\s*\{\s*"verifiableCredential"/.test(sample) ? 0.9 : 0),
  load: () => import("./wallettext.impl").then((m) => m.walletTextImpl),
};
