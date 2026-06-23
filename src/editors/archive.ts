import type { EditorDescriptor } from "../core/types";

export const archiveEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "archive", consumesViews: ["archive"], readOnly: true },
  load: () => import("./archive.impl").then((m) => m.archiveEditor),
};
