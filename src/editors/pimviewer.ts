import type { EditorDescriptor } from "../core/types";

// Read-only viewer for iCalendar events (.ics) and vCard contacts (.vcf), via ical.js.
// Editing is available by switching to the raw text editor.
export const pimViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "pimviewer", consumesViews: ["pim"], readOnly: true },
  load: () => import("./pimviewer.impl").then((m) => m.pimViewer),
};
