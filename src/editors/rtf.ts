import type { EditorDescriptor } from "../core/types";

export const rtfEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "rtf", consumesViews: ["rtf"], readOnly: true },
  load: () => import("./rtf.impl").then((m) => m.rtfEditor),
};
