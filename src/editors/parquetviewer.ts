import type { EditorDescriptor } from "../core/types";

// Read-only Apache Parquet viewer (hyparquet): columns/rows in a grid. Read-only.
export const parquetViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "parquetviewer", consumesViews: ["parquet"], readOnly: true },
  load: () => import("./parquetviewer.impl").then((m) => m.parquetViewer),
};
