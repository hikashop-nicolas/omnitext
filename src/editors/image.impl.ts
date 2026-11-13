import { createImageViewer, type ExtractSource, type ImageViewerHandle } from "imageview";
import { isNative } from "../core/platform";
import { ReadingFullscreen } from "./reading-fullscreen";
import { readSheetMusic } from "./sheet-scan";
import { t } from "../i18n";
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

const MUSIC_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

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
      },
    );
    this.fullscreen.attach(this.handle);
    // A photo or scan of sheet music can be read into an editable score.
    const scan = document.createElement("button");
    scan.className = "iv-bb-icon";
    scan.innerHTML = MUSIC_ICON;
    scan.title = t("scan.read");
    scan.setAttribute("aria-label", t("scan.read"));
    scan.addEventListener("click", () => void readSheetMusic(this.host, this.bytes ?? new Uint8Array(0), ctx.mime, ctx.filename));
    this.handle.getBarEnd().append(scan);
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
