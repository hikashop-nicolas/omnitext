import type { EditorDescriptor } from "../core/types";

export const latexPreviewEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "latexpreview", consumesViews: ["latex"], readOnly: true },
  load: () => import("./latexpreview.impl").then((m) => m.latexPreviewEditor),
};
