import type { FormatDescriptor } from "../core/types";

export const sqlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "sql",
    extensions: [".sql"],
    mimeTypes: ["application/sql"],
    nativeEditor: "codemirror",
  },
  detect({ sample }) {
    return /\b(select|insert|update|delete|create|alter|drop)\b/i.test(sample) ? 0.25 : 0;
  },
  load: () => import("./sql.impl").then((m) => m.sqlImpl),
};
