import type {
  EditorRegistryReadonly,
  EditorResolution,
  FormatDescriptor,
} from "./types";

export interface ResolveOptions {
  /** Id of the universal fallback editor (a text editor). Config, not a literal. */
  fallbackEditorId: string;
  /** Optional per-format user override: format id -> editor id. */
  preferredByFormat?: Record<string, string>;
}

/**
 * Enumerate the editors that can render a document, best fidelity first:
 *   1. the format's native editor,
 *   2. generic editors that consume one of the format's view adapters,
 *   3. the configured text fallback (always works, since text is canonical).
 * Deduplicated by editor id, preserving the best reason for each.
 */
export function editorCandidates(
  format: FormatDescriptor | null,
  editors: EditorRegistryReadonly,
  fallbackEditorId: string,
): EditorResolution[] {
  const out: EditorResolution[] = [];
  const seen = new Set<string>();
  const add = (res: EditorResolution) => {
    if (seen.has(res.editor.manifest.id)) return;
    seen.add(res.editor.manifest.id);
    out.push(res);
  };

  if (format) {
    const native = format.manifest.nativeEditor;
    if (native) {
      const ed = editors.byId(native);
      if (ed) add({ editor: ed, view: ed.manifest.consumesViews[0] ?? "text", reason: "native" });
    }
    for (const view of format.manifest.viewAdapters ?? []) {
      for (const ed of editors.consumersOf(view)) add({ editor: ed, view, reason: "view" });
    }
  }

  // The universal text fallback only applies to text documents.
  if (!format?.manifest.binary) {
    const fallback = editors.byId(fallbackEditorId);
    if (fallback) add({ editor: fallback, view: "text", reason: "fallback" });
  }

  // Promote the format's preferred default editor to the front (the "nicest" surface).
  const def = format?.manifest.defaultEditor;
  if (def) {
    const i = out.findIndex((c) => c.editor.manifest.id === def);
    if (i > 0) out.unshift(out.splice(i, 1)[0]!);
  }

  return out;
}

/**
 * Pick the single editor for a document: a per-format user override if set, else the
 * first candidate (native > view > fallback).
 */
export function resolveEditor(
  format: FormatDescriptor | null,
  editors: EditorRegistryReadonly,
  opts: ResolveOptions,
): EditorResolution {
  const candidates = editorCandidates(format, editors, opts.fallbackEditorId);

  if (format) {
    const overrideId = opts.preferredByFormat?.[format.manifest.id];
    const override = candidates.find((c) => c.editor.manifest.id === overrideId);
    if (override) return override;
  }

  const first = candidates[0];
  if (!first) {
    throw new Error(`fallback editor "${opts.fallbackEditorId}" is not registered`);
  }
  return first;
}
