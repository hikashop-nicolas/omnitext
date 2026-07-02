import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createPdfEditor, type PdfEditor, type PdfEditState } from "pdfedit";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";

// Unicode fallback font for PDF exports: characters the document's own fonts and the
// standard fonts can't encode (Cyrillic, Greek, CJK, ...) are drawn with this instead
// of being dropped. Noto Sans JP (OFL, see NotoSansJP-LICENSE.txt) also covers Latin,
// Greek and Cyrillic. Fetched lazily: only the first save that needs it pays the cost.
const fallbackFontUrl = new URL("../assets/NotoSansJP-Regular.otf", import.meta.url).href;
let fallbackFetch: Promise<Uint8Array | null> | null = null;
const loadFallbackFont = (): Promise<Uint8Array | null> => {
  fallbackFetch ??= fetch(fallbackFontUrl)
    .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
    .catch(() => null);
  return fallbackFetch;
};

// Thin adapter wrapping the standalone pdfedit library as an Omnitext editor module.
class PdfInstance implements EditorInstance {
  private editor: PdfEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();
  private container: HTMLElement | null = null;
  private onChange: (() => void) | undefined;

  constructor(private host: HostAPI) {}

  private options(onChange: (() => void) | undefined) {
    return {
      workerSrc: workerUrl,
      onChange,
      fallbackFont: loadFallbackFont,
      onWarning: (m: string) => this.host.notifications.warn(m),
    };
  }

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.container = container;
    this.onChange = ctx.onChange;
    this.bytes = ctx.bytes ?? new Uint8Array();
    this.editor = createPdfEditor(container, this.bytes, this.options(ctx.onChange));
  }

  getText(): string {
    return "";
  }

  getBytes(): Promise<Uint8Array> {
    return this.editor ? this.editor.getBytes() : Promise.resolve(this.bytes);
  }

  // History snapshots the editing session (pristine bytes + edits), not the lossy export.
  getState(): unknown {
    return this.editor?.getState() ?? null;
  }

  // Restore re-renders the pristine document and replays the edits, in place.
  setState(state: unknown): void {
    if (!this.container || !state) return;
    const st = state as PdfEditState;
    this.editor?.destroy();
    this.bytes = st.original;
    this.editor = createPdfEditor(this.container, st.original, {
      ...this.options(this.onChange),
      initialState: st,
    });
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  dispose(): void {
    this.editor?.destroy();
    this.editor = null;
  }
}

export const pdfEditor: EditorModule = {
  create: (host) => new PdfInstance(host),
};
