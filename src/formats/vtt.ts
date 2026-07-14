import type { FormatDescriptor } from "../core/types";

// WebVTT (.vtt): HTML5 subtitle/caption format. Default surface is the subedit cue editor;
// the raw text stays available via the CodeMirror text view. Model === text.
export const vttFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "vtt",
    extensions: [".vtt"],
    mimeTypes: ["text/vtt"],
    nativeEditor: "subtitle",
    defaultEditor: "subtitle",
  },
  // A VTT file begins with the "WEBVTT" signature line.
  detect({ sample }) {
    return /^﻿?WEBVTT(?:\s|$)/.test(sample) ? 0.9 : 0;
  },
  load: () => import("./subtitles.impl").then((m) => m.subtitlesImpl),
};
