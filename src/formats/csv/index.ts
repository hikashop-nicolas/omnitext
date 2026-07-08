import type { FormatDescriptor } from "../../core/types";
import { sniffConfidence } from "./sniff";

export const csvFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "csv",
    extensions: [".csv"],
    mimeTypes: ["text/csv"],
    viewAdapters: ["table"],
  },
  detect({ sample }) {
    return sniffConfidence(sample);
  },
  load: () => import("./impl").then((m) => m.csvImpl),
};
