import type { FormatDescriptor } from "../core/types";

/** Offset just past the first top-level value in the sample, or -1 if the sample ends first. */
function firstValueEnd(s: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return i + 1;
  }
  return -1;
}

// Lightweight descriptor (eagerly registered). The parser + CodeMirror language load
// on demand from ./json.impl when a JSON document is actually opened.
export const jsonFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "json",
    extensions: [".json"],
    mimeTypes: ["application/json"],
    nativeEditor: "codemirror",
    viewAdapters: ["tree"],
    defaultEditor: "tree",
  },
  detect({ sample }) {
    const s = sample.trimStart();
    if (!s.startsWith("{") && !s.startsWith("[")) return 0;
    // Log lines open with a bracket too ("[    0.000000] Booting Linux", issue #43). In
    // JSON nothing but whitespace follows the value the first bracket opens.
    const end = firstValueEnd(s);
    return end === -1 || s.slice(end).trim() === "" ? 0.6 : 0;
  },
  load: () => import("./json.impl").then((m) => m.jsonImpl),
};
