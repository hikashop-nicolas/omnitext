// The project's public home, in one place: the settings dialog links to it, and the binary
// fallback builds a "please support this format" issue URL from it.

export const REPO_URL = "https://github.com/hikashop-nicolas/omnitext";

/**
 * Extension of a filename, lowercased and including the dot ("" when there is none).
 *
 * This lives here rather than at the call site because it is what keeps the rest of the name
 * out of the issue link: a file called "holiday-budget.foo" must contribute ".foo" and no
 * more.
 */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

/**
 * A prefilled issue asking for a format Omnitext could not open.
 *
 * Only the extension and the browser's MIME guess go in, never the filename and never a byte
 * of the file. Opening this sends nothing either: it fills a form on GitHub that the reader
 * can edit or abandon, and the app has no way to submit it.
 */
/** A problem report for a supported format that failed to read a file; carries the reader's error. */
export function readFailureUrl(ext: string, format: string, message: string, mime?: string): string {
  const title = `Cannot open a ${ext || format} file`;
  const body = [
    `Omnitext supports ${format} files but could not read this one, so it showed the raw bytes.`,
    ``,
    `- Extension: ${ext || "(none)"}`,
    `- Type reported by the browser: ${mime || "(none)"}`,
    `- Error: ${message}`,
    ``,
    `Which program made the file, and does it open elsewhere?`,
  ].join("\n");
  const q = new URLSearchParams({ title, body, labels: "bug" });
  return `${REPO_URL}/issues/new?${q.toString()}`;
}

export function formatRequestUrl(ext: string, mime?: string): string {
  const what = ext || (mime ?? "unknown");
  const title = `Support ${what} files`;
  const body = [
    `Omnitext opened this as raw bytes rather than as a document.`,
    ``,
    `- Extension: ${ext || "(none)"}`,
    `- Type reported by the browser: ${mime || "(none)"}`,
    ``,
    `What is this file, and what would you want to do with it here?`,
  ].join("\n");
  const q = new URLSearchParams({ title, body, labels: "enhancement" });
  return `${REPO_URL}/issues/new?${q.toString()}`;
}
