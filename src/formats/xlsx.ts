import type { FormatDescriptor } from "../core/types";

export const xlsxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "xlsx",
    // Macro workbooks and templates are the same package: sheetedit reads their macros and
    // keeps them, and their own content types, when it saves.
    extensions: [".xlsx", ".xlsm", ".xltx", ".xltm"],
    // Lowercase: Android matches MIME types case-sensitively and normalizes them to lowercase.
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
      "application/vnd.ms-excel.template.macroenabled.12",
    ],
    binary: true,
    viewAdapters: ["sheet"],
    defaultEditor: "sheet",
  },
  detect: () => 0, // binary; detected by extension
  load: () => import("./sheet.impl").then((m) => m.sheetBinaryImpl),
};
