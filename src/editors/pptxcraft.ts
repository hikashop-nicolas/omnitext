import type { EditorDescriptor } from "../core/types";

// The presentation editor on DeckCraft's engine (compiled to wasm, behind a Web Worker, through craftbridge).
// The default PPTX editor in builds that carry the engine; the others keep the read-only viewer.
export const pptxCraftEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "pptxcraft", consumesViews: ["pptx"] },
  load: () => import("./pptxcraft.impl").then((m) => m.pptxCraftEditor),
};
