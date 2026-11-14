import { createImageViewer, type ExtractSource, type ImageViewerHandle } from "imageview";
import { isNative } from "../core/platform";
import { ReadingFullscreen } from "./reading-fullscreen";
import { readSheetMusic } from "./sheet-scan";
import type { EditorInstance, EditorModule, EditorMountContext, HostAPI } from "../core/types";

// Thin adapter wrapping the standalone imageview library (read-only image viewer with
// click-to-toggle fit vs actual size; SVG renders inert through <img>; on-image QR/barcode
// detection with an info card) as an Omnitext editor module. imageview owns its own DOM,
// styles and i18n; this adapter feeds it the document bytes, routes "new document" (from a
// decoded code, and later OCR/translation output) through the host, and hands the original
// bytes back for history snapshots.
const EXTRACT_NAME: Record<ExtractSource, string> = {
  qr: "code.txt",
  ocr: "ocr.txt",
  translate: "translation.txt",
};


class ImageInstance implements EditorInstance {
  private handle: ImageViewerHandle | null = null;
  private bytes: Uint8Array | null = null;
  private fullscreen: ReadingFullscreen | null = null;

  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes;
    this.handle = createImageViewer(
      container,
      { bytes: ctx.bytes ?? new Uint8Array(0), mime: ctx.mime, filename: ctx.filename },
      {
        ...(this.fullscreen = new ReadingFullscreen(container, ".iv-shell")).options(),
        onExtractText: (text, meta) =>
          this.host.workspace.openFile?.(EXTRACT_NAME[meta.source], new TextEncoder().encode(text), "text/plain"),
        // OCR on a picture of sheet music reads the score instead of the text.
        onOcr: () => this.readIfSheetMusic(ctx.mime, ctx.filename),
      },
    );
    this.fullscreen.attach(this.handle);
  }

  /** True (and the reading started) when the picture shows staves; false lets text OCR run. */
  private async readIfSheetMusic(mime: string | undefined, filename: string | undefined): Promise<boolean> {
    const bytes = this.bytes;
    if (!bytes?.length) return false;
    try {
      const { looksLikeSheetMusic } = await import("scoredit/scan-detect");
      if (!(await looksLikeSheetMusic(new Blob([bytes as BlobPart], { type: mime ?? "image/png" }))).sheetMusic) return false;
    } catch {
      return false;
    }
    void readSheetMusic(this.host, bytes, mime, filename);
    return true;
  }

  getText(): string {
    return "";
  }

  getBytes(): Uint8Array | undefined {
    return this.bytes ?? undefined; // read-only: hand back the original for history snapshots
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  /** On the phone the viewer's bar takes the status bar's place, with the view switcher in it. */
  viewSwitcherSlot(): HTMLElement | null {
    return isNative() ? (this.handle?.getBarEnd() ?? null) : null;
  }

  dispose(): void {
    this.fullscreen?.dispose();
    this.fullscreen = null;
    this.handle?.destroy();
    this.handle = null;
  }
}

export const imageEditor: EditorModule = {
  create: (host) => new ImageInstance(host),
};
