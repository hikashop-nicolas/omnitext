import type { FormatDescriptor } from "../core/types";

// vCard (.vcf): contact cards, rendered by the PIM viewer; raw text editing stays
// available via the text editor.
export const vcfFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "vcf",
    extensions: [".vcf", ".vcard"],
    mimeTypes: ["text/vcard"],
    nativeEditor: "pimviewer",
    defaultEditor: "pimviewer",
  },
  detect: ({ sample }) => (/BEGIN:VCARD/i.test(sample) ? 0.9 : 0),
  load: () => import("./pim.impl").then((m) => m.pimImpl),
};
