import type { EditorDescriptor } from "../core/types";

// Read-only .torrent metadata viewer (@ctrl/torrent-file): name, size, trackers, file
// tree and info-hash. A torrent holds only metadata; there is nothing to download.
export const torrentViewer: EditorDescriptor = {
  manifest: { kind: "editor", id: "torrentviewer", consumesViews: ["torrent"], readOnly: true },
  load: () => import("./torrentviewer.impl").then((m) => m.torrentViewer),
};
