import type { FormatDescriptor } from "../core/types";

// Email messages (.eml, RFC 822): opened read-only in the email viewer (postal-mime).
// Treated as bytes so non-UTF-8 messages and binary attachments round-trip intact.
export const emlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "eml",
    extensions: [".eml"],
    mimeTypes: ["message/rfc822"],
    binary: true,
    nativeEditor: "emailviewer",
    defaultEditor: "emailviewer",
    soleEditor: true,
  },
  detect: () => 0, // routed by extension
  load: () => import("./email.impl").then((m) => m.emailImpl),
};
