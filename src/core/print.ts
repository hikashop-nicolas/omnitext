/**
 * Printing a document that the editor only partly renders.
 *
 * Print takes the DOM as it finds it, and an editor that virtualizes keeps only the rows
 * around the viewport in it, so printing the live surface yields the first page of a long
 * file and nothing else. Such an editor hands over a full rendering instead, which is put
 * in a sheet that only print shows, and taken out again afterwards: left behind, it would
 * be a stale copy of a document that has since been edited.
 *
 * `print` resolves when the printed page is no longer being read, which is not the same
 * moment on both platforms. In the browser that is the afterprint event; on Android the
 * system reads the WebView after the call returns, so tearing the sheet down when the call
 * resolves would pull the document out from under the printer.
 */
export interface PrintHost {
  /** Put a full rendering in the print-only sheet, or clear it with null. */
  fill(sheet: HTMLElement | null): void;
  /** Whether the sheet replaces the live editor for this print. */
  useSheet(on: boolean): void;
  /** Resolves once whatever prints has finished reading the page. */
  print(): Promise<void>;
}

/**
 * Print a PDF as the document it is.
 *
 * pdfedit draws each page into a canvas about 96 dpi wide, which is right for reading on a
 * screen and wrong for paper: printing those canvases prints photographs of the pages. The
 * bytes, with this session's edits already in them, describe the pages exactly, so they go
 * to the printer through a frame of their own and arrive at the resolution of the file.
 *
 * Returns false if the frame could not be printed, so the caller can fall back to the DOM.
 */
export async function printPdfBytes(bytes: Uint8Array): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0";
  let printed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("could not load the PDF for printing"));
      frame.src = url;
      document.body.appendChild(frame);
    });
    const view = frame.contentWindow;
    if (!view) return false;
    view.focus();
    view.print();
    printed = true;
    return true;
  } catch {
    return false;
  } finally {
    // Long after, never now: taking the frame away while the dialog is still open cancels
    // the print. A frame one pixel wide costs nothing in the meantime.
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, printed ? 120_000 : 0);
  }
}

export async function printDocument(sheet: HTMLElement | null, host: PrintHost): Promise<void> {
  if (!sheet) {
    await host.print(); // the live surface already holds the whole document
    return;
  }
  host.fill(sheet);
  host.useSheet(true);
  try {
    await host.print();
  } finally {
    // Even if printing threw or was cancelled: a sheet left up is shown instead of the
    // editor at the next print, holding a copy of a document that has since changed.
    host.fill(null);
    host.useSheet(false);
  }
}
