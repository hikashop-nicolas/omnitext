import type { EditorDescriptor } from "../core/types";

// Read-only DICOM viewer (dicom-parser): renders uncompressed images + tag metadata.
export const dicomViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "dicomviewer", consumesViews: ["dicom"], readOnly: true },
  load: () => import("./dicomviewer.impl").then((m) => m.dicomViewer),
};
