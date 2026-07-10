import type { EditorDescriptor } from "../core/types";

// Read-only Jupyter notebook viewer (notebookjs). Renders markdown/code/output cells;
// editing the underlying JSON is available via the raw text editor.
export const ipynbViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "ipynbviewer", consumesViews: ["ipynb"], readOnly: true },
  load: () => import("./ipynbviewer.impl").then((m) => m.ipynbViewer),
};
