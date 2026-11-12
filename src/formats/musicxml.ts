import type { FormatDescriptor } from "../core/types";

// MusicXML: XML text whose default surface is the scoredit score viewer; the raw XML stays
// available in the text view. A plain .xml holding a score is recognised by its root.
export const musicxmlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "musicxml",
    extensions: [".musicxml"],
    mimeTypes: ["application/vnd.recordare.musicxml+xml"],
    nativeEditor: "score",
    defaultEditor: "score",
  },
  detect({ sample }) {
    return /<score-(partwise|timewise)[\s>]/.test(sample) ? 0.9 : 0;
  },
  load: () => import("./musicxml.impl").then((m) => m.musicxmlImpl),
};

// Compressed MusicXML (a zip): only the score viewer can show it.
export const mxlFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "mxl",
    extensions: [".mxl"],
    mimeTypes: ["application/vnd.recordare.musicxml"],
    binary: true,
    nativeEditor: "score",
    defaultEditor: "score",
    soleEditor: true,
  },
  detect: () => 0, // a zip; routed by extension
  load: () => import("./musicxml.impl").then((m) => m.mxlImpl),
};

// MuseScore 3 and 4: the .mscz zip and the plain .mscx text, read by scoredit.
export const msczFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "mscz",
    extensions: [".mscz"],
    mimeTypes: ["application/vnd.musescore"],
    binary: true,
    nativeEditor: "score",
    defaultEditor: "score",
    soleEditor: true,
  },
  detect: () => 0, // a zip; routed by extension
  load: () => import("./musicxml.impl").then((m) => m.mxlImpl),
};

export const mscxFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "mscx",
    extensions: [".mscx"],
    mimeTypes: ["application/vnd.musescore+xml"],
    nativeEditor: "score",
    defaultEditor: "score",
  },
  detect({ sample }) {
    return /<museScore[\s>]/.test(sample) ? 0.9 : 0;
  },
  load: () => import("./musicxml.impl").then((m) => m.musicxmlImpl),
};

// Read by scoredit for viewing only: they open in the score viewer and are never rewritten.
// ABC is text, so the text view can still edit it.
export const abcFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "abc",
    extensions: [".abc"],
    mimeTypes: ["text/vnd.abc"],
    nativeEditor: "score",
    defaultEditor: "score",
  },
  detect({ sample }) {
    return /^X:\s*\d/m.test(sample) && /^K:/m.test(sample) ? 0.6 : 0;
  },
  load: () => import("./musicxml.impl").then((m) => m.musicxmlImpl),
};

// Guitar Pro 3 to 7. A .gpx is Guitar Pro 6 only when it starts with its container's mark;
// otherwise it is a GPS track.
export const guitarproFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "guitarpro",
    extensions: [".gp", ".gp3", ".gp4", ".gp5", ".gpx"],
    mimeTypes: ["application/x-guitar-pro"],
    binary: true,
    nativeEditor: "score",
    defaultEditor: "score",
    soleEditor: true,
  },
  detect: () => 0, // binary; routed by extension
  sniffBytes: (head) => /^BCF[ZS]/.test(String.fromCharCode(...head.subarray(0, 4))),
  load: () => import("./musicxml.impl").then((m) => m.mxlImpl),
};

export const midiFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "midi",
    extensions: [".mid", ".midi"],
    mimeTypes: ["audio/midi"],
    binary: true,
    nativeEditor: "score",
    defaultEditor: "score",
    soleEditor: true,
  },
  detect: () => 0, // binary; routed by extension
  load: () => import("./musicxml.impl").then((m) => m.mxlImpl),
};
