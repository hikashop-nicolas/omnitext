import { createImageViewer, type ExtractSource, type ImageViewerHandle } from "imageview";
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

  constructor(private host: HostAPI) {}

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.bytes = ctx.bytes;
    this.handle = createImageViewer(
      container,
      { bytes: ctx.bytes ?? new Uint8Array(0), mime: ctx.mime, filename: ctx.filename },
      {
        onExtractText: (text, meta) =>
          this.host.workspace.openFile?.(EXTRACT_NAME[meta.source], new TextEncoder().encode(text), "text/plain"),
      },
    );
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

  dispose(): void {
    this.handle?.destroy();
    this.handle = null;
  }
}

export const imageEditor: EditorModule = {
  create: (host) => new ImageInstance(host),
};
