import type { FormatDescriptor } from "../core/types";

// BitTorrent metainfo files (.torrent): bencoded binary, opened read-only in the torrent
// viewer. Bencoded dictionaries begin with "d" followed by the "announce"/"info" keys.
export const torrentFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "torrent",
    extensions: [".torrent"],
    mimeTypes: ["application/x-bittorrent"],
    binary: true,
    nativeEditor: "torrentviewer",
    defaultEditor: "torrentviewer",
    soleEditor: true,
  },
  detect: ({ sample }) => (/^d\d+:(announce|info|created|comment|encoding|url-list)/.test(sample) ? 1 : 0),
  load: () => import("./torrent.impl").then((m) => m.torrentImpl),
};
