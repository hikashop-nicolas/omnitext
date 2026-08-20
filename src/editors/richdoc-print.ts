import { isNative } from "../core/platform";

/** The subset of a richdoc editor this needs; the three adapters pass different types. */
interface Printable {
  setPrintHandler(handler: (() => void) | null): void;
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
