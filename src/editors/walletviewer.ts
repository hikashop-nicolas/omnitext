import type { EditorDescriptor } from "../core/types";

// Read-only viewer for Apple Wallet passes (.pkpass, .pkpasses), via walletview.
export const walletViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "walletviewer", consumesViews: ["wallet"], readOnly: true },
  load: () => import("./walletviewer.impl").then((m) => m.walletViewer),
};
