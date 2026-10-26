// Opening a web or mail address from inside a document. A browser takes it in a new tab; the Android
// WebView turns it into a navigation that it hands to the system browser instead. That navigation
// would trip the "unsaved changes" prompt of beforeunload, though the page is not going anywhere, so
// the handler asks whether an external open is under way.

let until = 0;

/** Opens a web or mail address outside the app. Anything else (a script, a file) is ignored. */
export function openExternal(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  until = Date.now() + 2000;
  window.open(url, "_blank", "noopener,noreferrer");
}

export const openingExternal = (): boolean => Date.now() < until;
