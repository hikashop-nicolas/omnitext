import type { EditorDescriptor } from "../core/types";

// Read-only Adobe Illustrator (.ai) viewer. Modern .ai files are saved PDF-compatible
// (an embedded PDF stream); this renders that stream with pdf.js. There is no browser
// library that parses native Illustrator artwork, and ai2html is an Illustrator script,
// not a client-side reader, so this is the realistic client-side view.
export const aiViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "aiviewer", consumesViews: ["ai"], readOnly: true },
  load: () => import("./aiviewer.impl").then((m) => m.aiViewer),
};
