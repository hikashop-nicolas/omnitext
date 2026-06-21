import type { EditorDescriptor } from "../core/types";

export const odtEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "odt", consumesViews: ["odt"] },
  load: () => import("./odt.impl").then((m) => m.odtEditor),
};
