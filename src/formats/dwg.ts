import type { FormatDescriptor } from "../core/types";

// DWG drawings (.dwg, AutoCAD's native format): opened read-only in the 2D CAD viewer,
// which reads them in the page through cadview. Binary and closed, so it is fed as bytes
// and never round-trips to text.
export const dwgFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "dwg",
    extensions: [".dwg"],
    mimeTypes: ["image/vnd.dwg", "application/acad"],
    binary: true,
    nativeEditor: "dxfviewer",
    defaultEditor: "dxfviewer",
    soleEditor: true,
  },
  // A DWG starts with its version, "AC" and four digits (AC1027 is AutoCAD 2013). That is
  // a real signature rather than a guess, so it is worth answering on content as well as
  // on the extension.
  detect: ({ sample }) => (/^AC\d{4}/.test(sample) ? 0.9 : 0),
  load: () => import("./dwg.impl").then((m) => m.dwgImpl),
};
