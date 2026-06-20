import type {
  EditorRegistryReadonly,
  EditorResolution,
  FormatModule,
} from "./types";

export interface ResolveOptions {
  /** Id of the universal fallback editor (a text editor). Config, not a literal. */
  fallbackEditorId: string;
  /** Optional per-format user override: format id -> editor id. */
  preferredByFormat?: Record<string, string>;
}

/**
 * Pick the editor for a document, best fidelity first:
 *   1. user override for this format,
 *   2. the format's native editor,
 *   3. a generic editor that consumes one of the format's view adapters,
 *   4. the configured text fallback editor.
 * The fallback always works because text is the canonical representation.
 */
export function resolveEditor(
  format: FormatModule | null,
  editors: EditorRegistryReadonly,
  opts: ResolveOptions,
): EditorResolution {
  if (format) {
    const override = opts.preferredByFormat?.[format.manifest.id];
    if (override) {
      const ed = editors.byId(override);
      if (ed) {
        const view = ed.manifest.consumesViews[0] ?? "text";
        return { editor: ed, view, reason: "view" };
      }
    }

    const native = format.manifest.nativeEditor;
    if (native) {
      const ed = editors.byId(native);
      if (ed) return { editor: ed, view: ed.manifest.consumesViews[0] ?? "text", reason: "native" };
    }

    for (const view of format.manifest.viewAdapters ?? []) {
      const [ed] = editors.consumersOf(view);
      if (ed) return { editor: ed, view, reason: "view" };
    }
  }

  const fallback = editors.byId(opts.fallbackEditorId);
  if (!fallback) {
    throw new Error(`fallback editor "${opts.fallbackEditorId}" is not registered`);
  }
  return { editor: fallback, view: "text", reason: "fallback" };
}
