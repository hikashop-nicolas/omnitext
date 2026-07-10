import type { FormatDescriptor } from "../core/types";

// DICOM medical images (.dcm/.dicom): binary, opened read-only in the DICOM viewer. The
// format has a 128-byte preamble then the "DICM" magic at offset 128.
export const dicomFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "dicom",
    extensions: [".dcm", ".dicom"],
    mimeTypes: ["application/dicom"],
    binary: true,
    nativeEditor: "dicomviewer",
    defaultEditor: "dicomviewer",
    soleEditor: true,
  },
  detect: ({ sample }) => (sample.slice(128, 132) === "DICM" ? 1 : 0),
  load: () => import("./dicom.impl").then((m) => m.dicomImpl),
};
