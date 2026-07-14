import type { EditorDescriptor } from "../core/types";

// Subtitle-editing surface for SRT / VTT / ASS / SSA, built on the standalone subedit
// library: a virtualized cue list, a per-cue timing/text detail pane, an embedded
// video/waveform preview and byte-preserving round-trips. The raw file stays editable
// through the CodeMirror text view.
export const subtitleEditor: EditorDescriptor = {
  manifest: { kind: "editor", id: "subtitle", consumesViews: ["subtitle"] },
  load: () => import("./subtitle.impl").then((m) => m.subtitleEditor),
};
