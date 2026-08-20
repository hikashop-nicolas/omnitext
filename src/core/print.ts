/**
 * Printing a document that the editor only partly renders.
 *
 * Print takes the DOM as it finds it, and an editor that virtualizes keeps only the rows
 * around the viewport in it, so printing the live surface yields the first page of a long
 * file and nothing else. Such an editor hands over a full rendering instead, which is put
 * in a sheet that only print shows, and taken out again afterwards: left behind, it would
 * be a stale copy of a document that has since been edited.
 */
export interface PrintHost {
  /** Put a full rendering in the print-only sheet, or clear it with null. */
  fill(sheet: HTMLElement | null): void;
  /** Whether the sheet replaces the live editor for this print. */
  useSheet(on: boolean): void;
  print(): void;
  /** Register a one-shot callback for when printing is over. */
  onceAfterPrint(cb: () => void): void;
}

export function printDocument(sheet: HTMLElement | null, host: PrintHost): void {
  if (!sheet) {
    host.print(); // the live surface already holds the whole document
    return;
  }
  host.fill(sheet);
  host.useSheet(true);
  host.onceAfterPrint(() => {
    host.fill(null);
    host.useSheet(false);
  });
  host.print();
}
