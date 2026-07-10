import type { FormatDescriptor } from "../core/types";

// Outlook messages (.msg, OLE compound file): opened read-only in the email viewer
// (@kenjiuno/msgreader). Detected by extension; the OLE magic is shared with .doc/.xls.
export const msgFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "msg",
    extensions: [".msg"],
    mimeTypes: ["application/vnd.ms-outlook"],
    binary: true,
    nativeEditor: "emailviewer",
    defaultEditor: "emailviewer",
    soleEditor: true,
  },
  detect: () => 0, // routed by extension
  load: () => import("./email.impl").then((m) => m.emailImpl),
};
