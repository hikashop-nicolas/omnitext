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
