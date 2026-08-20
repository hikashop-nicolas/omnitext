import { isNative } from "../core/platform";

/** The subset of a richdoc editor this needs; the three adapters pass different types. */
interface Printable {
  setPrintHandler(handler: (() => void) | null): void;
  printClone(): HTMLElement;
}

/**
 * The pages to print, away from the editor they live in.
 *
 * Printing the surface prints the pages where they sit: on the editor's grey backdrop, at
 * the zoom in use, under its bars, which on paper is a small page floating in grey. The
 * copy richdoc hands over has none of that around it, and the print sheet shows it instead
 * of the editor.
 */
export function richdocPrintable(editor: Printable | null): HTMLElement | null {
  if (!editor) return null;
  const pages = editor.printClone();
  const sheet = document.createElement("div");
  sheet.className = "print-pages";
  sheet.appendChild(pages);
  return sheet;
}

/**
 * Take richdoc's print button over in the app, and leave it alone in a browser.
 *
 * Its own print opens a window and prints a clone of the pages with page rules matched to
 * their geometry, which is the better paginated result and is worth keeping on the web. It
 * rests on window.print(), which a WebView does not implement, so in the app that button
 * opened a window and printed nothing. There it goes through the host instead, which
 * prints through Android's printer.
 */
export function takeOverPrinting(editor: Printable): void {
  if (!isNative()) return;
  editor.setPrintHandler(() => window.dispatchEvent(new CustomEvent("omnitext:print")));
}
