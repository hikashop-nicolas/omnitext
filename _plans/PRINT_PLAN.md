# Printing

Printing has to work in the browser, in the installed PWA, and in the Android app, and the
documents people will actually print are rich documents (richdoc: .docx / .odt) and PDFs.

## Where it stands

Ctrl/Cmd+P and a "Print / Save as PDF" palette entry call `window.print()` under a print
stylesheet that hides the app chrome (`app.css`, `@media print`).

Measured, not assumed:

- **Text (CodeMirror)** printed 19 lines of a 3000-line file, because the editor keeps only
  the lines around the viewport in the DOM. Fixed: an editor may hand over a full rendering
  through `EditorInstance.printable()`, which goes into a print-only sheet.
- **PDF (pdfedit)** renders each page into a canvas about 773px wide, roughly 96 dpi. All
  pages of a 3-page file were present. So it prints, but as screen-resolution bitmaps, with
  pdfedit's own toolbar and find bar on the first page, and no page breaks between pages.
- **richdoc** not yet measured. Its own toolbar and ruler are app-level chrome that the
  print stylesheet does not hide.
- **Android** prints nothing at all: `window.print()` is not implemented in a WebView, so
  the shortcut and the palette entry are inert.

## Design

Two kinds of document, two mechanisms.

**A PDF should print as a PDF, not as pictures of one.** The bytes are right there, edits
included, via `getBytes()`. Rendering them again from canvases throws away the resolution
and the pagination the file already carries.

- Web: a blob URL in a hidden iframe, printed through its own `contentWindow`.
- Android: `PrintManager` with an adapter that streams those bytes.

**Everything else prints as the DOM it already is**, under the print stylesheet, with each
editor's own chrome hidden and `printable()` filling in for whatever virtualizes.

- Web: `window.print()`, as today.
- Android: `WebView.createPrintDocumentAdapter()`, which prints the WebView's own rendering
  and so honours the same `@media print` rules. One set of print CSS, not two.

## Steps

1. ~~`printable()` hook + CodeMirror~~ (done, e6c78e6)
2. ~~Editor chrome hidden in print CSS~~ and ~~PDF prints its own bytes on the web~~ (8f398b8,
   this one). Verified that the exact bytes reach the print frame, and that the page's own
   `window.print` is no longer what runs. The dialog itself is unverified: opening it from
   an automated session freezes the tab, so that last step needs a person.
3. ~~Android plugin printing the WebView~~ (8f398b8, verified on the device).
4. ~~Android prints a PDF as the file, through a `PrintDocumentAdapter` that streams it to
   `PrintManager`~~. Verified on the device: the preview showed the PDF's own text, sharp
   and at the coordinates the file gives, rather than a picture of a canvas.
5. richdoc: toolbar and rulers hidden (confirmed through the CSSOM), and it renders the
   whole document rather than a window onto it, so it needs no print sheet: an 800
   paragraph file had all 800 in the DOM. Still unchecked: how its pagination lines up
   with the page-size setting, which needs a printed page to judge.

## Left open

- ~~richdoc's own print button printed nothing in the app~~ (richdoc 37b4c9f + here). It
  keeps its paginated window in a browser and routes to the platform in the app, verified
  both ways.
- ~~The app's printed page for richdoc showed the page at its on-screen zoom on the grey
  editor backdrop, under its bars.~~ richdoc hands over a clean copy of the pages
  (`printClone`, be57fc0) and the adapters return it from `printable()`, so the print sheet
  replaces the editor and the page fills the paper. Verified on the device: the preview
  went from a small page floating in grey to a full A4 page.

- The print dialog itself is never verified from here: opening one from an automated
  session freezes the tab. Everything up to the call is checked; the last step wants eyes.
- Other virtualized surfaces (the spreadsheet grid, the subtitle cue list) presumably
  truncate the way CodeMirror did. `printable()` is the place to fix each, unmeasured.

## Notes

- Build the APK locally with Android Studio's JDK:
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`, SDK at
  `~/Library/Android/sdk`, `android/local.properties` already points at it.
- Never call `window.print()` from an automated browser session: the dialog is modal and
  freezes the tab. Stub `window.print` in a test harness and record what it would print.
- A harness page served under the app's scope is shadowed by the service worker's SPA
  fallback on any visit after the first. Use a fresh port per run.
