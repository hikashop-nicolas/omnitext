import type { EditorDescriptor } from "../core/types";

export const mediaEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "media", consumesViews: ["media"], readOnly: true },
  load: () => import("./media.impl").then((m) => m.mediaEditor),
};
