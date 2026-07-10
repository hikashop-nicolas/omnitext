import type { FormatDescriptor } from "../core/types";

// Apache Parquet (.parquet): binary columnar data, opened read-only in the Parquet
// viewer (hyparquet). Every Parquet file starts and ends with the "PAR1" magic.
export const parquetFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "parquet",
    extensions: [".parquet", ".pq"],
    mimeTypes: ["application/vnd.apache.parquet"],
    binary: true,
    nativeEditor: "parquetviewer",
    defaultEditor: "parquetviewer",
    soleEditor: true,
  },
  detect: ({ sample }) => (sample.startsWith("PAR1") ? 1 : 0),
  load: () => import("./parquet.impl").then((m) => m.parquetImpl),
};
