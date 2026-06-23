import type { EditorDescriptor } from "../core/types";

export const binaryEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "binary", consumesViews: ["binary"], readOnly: true },
  load: () => import("./binary.impl").then((m) => m.binaryEditor),
};
