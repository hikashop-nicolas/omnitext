import type { EditorDescriptor } from "../core/types";

// Read-only email viewer for .eml and Outlook .msg. Renders headers, the message body
// (sandboxed, remote content blocked) and the attachment list.
export const emailViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "emailviewer", consumesViews: ["email"], readOnly: true },
  load: () => import("./emailviewer.impl").then((m) => m.emailViewer),
};
