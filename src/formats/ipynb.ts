import type { FormatDescriptor } from "../core/types";

// Jupyter notebooks (.ipynb): JSON text, rendered by the notebook viewer by default.
// Not a sole editor: switching to the text editor gives raw JSON editing with
// highlighting. Detection keys on the notebook's nbformat marker.
export const ipynbFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ipynb",
    extensions: [".ipynb"],
    mimeTypes: ["application/x-ipynb+json"],
    nativeEditor: "ipynbviewer",
    defaultEditor: "ipynbviewer",
  },
  detect({ sample }) {
    return /"nbformat"\s*:/.test(sample) && /"cells"\s*:/.test(sample) ? 0.9 : 0;
  },
  load: () => import("./ipynb.impl").then((m) => m.ipynbImpl),
};
