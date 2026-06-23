import type { FormatDescriptor } from "../core/types";

export const xmlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "xml",
    extensions: [".xml", ".xsd", ".xsl"],
    mimeTypes: ["application/xml", "text/xml"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return sample.trimStart().startsWith("<") ? 0.5 : 0;
  },
  load: () => import("./xml.impl").then((m) => m.xmlImpl),
};
