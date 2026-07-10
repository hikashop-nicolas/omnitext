import type { FormatDescriptor } from "../core/types";

// SQLite database files (.db/.sqlite/.sqlite3): binary, opened read-only in the SQLite
// viewer (sql.js). Every SQLite file begins with the ASCII header "SQLite format 3",
// which we sniff so generically-named files (e.g. .db) still route here.
export const sqliteFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "sqlite",
    extensions: [".sqlite", ".sqlite3", ".db", ".db3"],
    mimeTypes: ["application/vnd.sqlite3", "application/x-sqlite3"],
    binary: true,
    nativeEditor: "sqliteviewer",
    defaultEditor: "sqliteviewer",
    soleEditor: true,
  },
  detect: ({ sample }) => (sample.startsWith("SQLite format 3") ? 1 : 0),
  load: () => import("./sqlite.impl").then((m) => m.sqliteImpl),
};
