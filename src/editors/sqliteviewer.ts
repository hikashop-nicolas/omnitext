import type { EditorDescriptor } from "../core/types";

// Read-only SQLite viewer: lists tables, shows rows and runs ad-hoc queries via sql.js
// (SQLite compiled to WASM). Writing back to the database file is out of scope.
export const sqliteViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "sqliteviewer", consumesViews: ["sqlite"], readOnly: true },
  load: () => import("./sqliteviewer.impl").then((m) => m.sqliteViewer),
};
