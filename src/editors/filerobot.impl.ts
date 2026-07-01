import type { EditorInstance, EditorModule, EditorMountContext } from "../core/types";

// Thin adapter wrapping the standalone (vanilla) Filerobot Image Editor as an Omnitext editor.
// Raster only; editing re-encodes the image to the saved type (an animated GIF flattens to one
// frame). The library is lazy-loaded, so its (large) chunk is fetched only when this editor mounts.

type ImgData = { imageBase64?: string };
type CurrentResult = { imageData: ImgData; designState: unknown; hideLoadingSpinner?: () => void };
type GetCurrentFn = (fileInfo?: unknown, pixelRatio?: number, keepSpinner?: boolean) => CurrentResult;
interface FilerobotInstanceApi {
  render(extra?: { onClose?: () => void }): void;
  terminate?(): void;
}
type FilerobotCtor = new (container: HTMLElement, config: Record<string, unknown>) => FilerobotInstanceApi;

// Saved type follows the source where Filerobot supports it; everything else exports as PNG.
const SAVED_TYPE_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

// Hide Filerobot's own Save (Omnitext's Save owns the write-back, reading the edited image
// via getCurrentImgDataFnRef) and its Close "X" (a no-op here), so there is one Save button
// and no dead control. Undo/redo/reset stay. Injected once.
const STYLE_ID = "ot-filerobot-style";
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = ".FIE_topbar-save-wrapper,.FIE_topbar-save-button,.FIE_topbar-close-button{display:none!important;}";
  document.head.appendChild(s);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const bin = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class FilerobotInstance implements EditorInstance {
  private host: HTMLElement | null = null;
  private editor: FilerobotInstanceApi | null = null;
  private current: { current: GetCurrentFn | null } = { current: null };
  private srcUrl: string | null = null;
  private savedType = "png";
  private original: Uint8Array = new Uint8Array();

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    ensureStyle();
    this.original = ctx.bytes ?? new Uint8Array();
    const mime = ctx.mime || "image/png";
    this.savedType = SAVED_TYPE_BY_MIME[mime] ?? "png";
    this.srcUrl = URL.createObjectURL(new Blob([this.original as BlobPart], { type: mime }));
    if (!container.style.position) container.style.position = "relative";
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;inset:0;";
    container.appendChild(host);
    this.host = host;
    void this.init(host, ctx.onChange);
  }

  private async init(host: HTMLElement, onChange: () => void): Promise<void> {
    try {
      const mod = await import("filerobot-image-editor");
      const Filerobot = (mod.default ?? mod) as unknown as FilerobotCtor;
      const editor = new Filerobot(host, {
        source: this.srcUrl as string,
        defaultSavedImageType: this.savedType,
        defaultSavedImageQuality: 0.92,
        getCurrentImgDataFnRef: this.current,
        useBackendTranslations: false,
        onModify: () => onChange(),
      });
      if (!this.host) {
        editor.terminate?.(); // disposed while the library was loading
        return;
      }
      editor.render({ onClose: () => {} });
      this.editor = editor;
    } catch (e) {
      host.textContent = `Could not load the image editor: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  getText(): string {
    return ""; // binary editor
  }

  // Export the current edited image. Falls back to the original bytes if the editor is not ready.
  getBytes(): Uint8Array {
    const fn = this.current.current;
    if (!fn) return this.original;
    try {
      const res = fn(undefined, 1, false);
      res.hideLoadingSpinner?.();
      return res.imageData?.imageBase64 ? dataUrlToBytes(res.imageData.imageBase64) : this.original;
    } catch {
      return this.original;
    }
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  dispose(): void {
    this.editor?.terminate?.();
    this.editor = null;
    if (this.srcUrl) {
      URL.revokeObjectURL(this.srcUrl);
      this.srcUrl = null;
    }
    this.host?.remove();
    this.host = null;
  }
}

export const filerobotEditor: EditorModule = {
  create: () => new FilerobotInstance(),
};
