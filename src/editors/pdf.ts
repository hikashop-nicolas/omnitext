import type { EditorDescriptor } from "../core/types";

export const pdfEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "pdf", consumesViews: ["pdf"] },
  load: () => import("./pdf.impl").then((m) => m.pdfEditor),
};
