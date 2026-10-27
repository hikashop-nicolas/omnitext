import type { EditorDescriptor } from "../core/types";

// The PDF editor on PdfCraft's engine (compiled to wasm, behind a Web Worker, through craftbridge).
// The PDF editor.
export const pdfCraftEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "pdfcraft", consumesViews: ["pdf"] },
  load: () => import("./pdfcraft.impl").then((m) => m.pdfCraftEditor),
};
