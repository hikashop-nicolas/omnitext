import { Capacitor, registerPlugin } from "@capacitor/core";

// Platform helpers. On the web isNative() is false, so every web code path stays
// exactly as before; the native branches only run inside the Android/iOS app.

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// Native "Open with": the FileOpener plugin (android/.../FileOpenerPlugin.java) copies the
// file the OS handed us (a content:// URI the WebView itself cannot read) into the app cache
// and reports where. We pull that via getPendingFile() on startup and on resume (a pull model
// avoids the race where an onNewIntent fires before JS has a listener), then fetch it as a
// Blob so it takes the same streaming path a dropped file does.
//
// It used to come across as base64 in the bridge message. That cannot carry a video: the file
// is held in memory whole, a third larger encoded, as one JSON string - and when it failed the
// app opened an empty document, with nothing said about the file that had been asked for.
interface OpenedPayload {
  name?: string;
  mime?: string;
  /** An http URL the WebView can fetch, pointing at the staged copy. */
  url?: string;
  size?: number;
}
interface FileOpenerPlugin {
  getPendingFile(): Promise<OpenedPayload>;
}
const FileOpener = registerPlugin<FileOpenerPlugin>("FileOpener");

interface PrinterPlugin {
  print(options: { name: string }): Promise<void>;
  printFile(options: { path: string; name: string }): Promise<void>;
}
const Printer = registerPlugin<PrinterPlugin>("Printer");

/**
 * Print through Android's PrintManager, returning false on the web so the caller falls back
 * to window.print(). A WebView does not implement window.print() at all, so without this the
 * app's print command did nothing on the phone and said nothing about why.
 *
 * The native side prints the WebView's own rendering, which means the print stylesheet that
 * shapes a printed page in the browser shapes it here too.
 */
/**
 * Print an already-printable document (a PDF) through Android's printer, so its pages go
 * out as the file describes them rather than as the canvases they are drawn on.
 *
 * Staged in the app cache and handed over as a path: the native side streams it from
 * there. The alternative, sending the document across the bridge, is the thing that broke
 * on real files when opening used to work that way.
 */
export async function printFileNative(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const path = `print/${filename || "document.pdf"}`;
    await Filesystem.writeFile({
      path,
      data: bytesToBase64(bytes),
      directory: Directory.Cache,
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Printer.printFile({ path: uri.replace(/^file:\/\//, ""), name: filename || "document" });
    return true;
  } catch (e) {
    console.error("[omnitext] native file print failed", e);
    return false;
  }
}

export async function printNative(name: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await Printer.print({ name });
    return true;
  } catch (e) {
    console.error("[omnitext] native print failed", e);
    return false;
  }
}

export interface OpenedFile {
  /** The file itself, streamed from the staged copy rather than copied through the bridge. */
  file: File;
  name: string;
  mime?: string;
}

/** Raised when the OS asked us to open something and we could not: better said than swallowed. */
export class OpenedFileError extends Error {
  constructor(readonly filename: string, cause?: unknown) {
    super(`could not read ${filename}`, cause === undefined ? undefined : { cause });
    this.name = "OpenedFileError";
  }
}

/**
 * A file opened via "Open with", if one is pending (null on the web or a normal launch).
 * Throws OpenedFileError when one WAS pending and could not be read, so the caller can say so
 * instead of quietly showing a blank document.
 */
export async function getOpenedFile(): Promise<OpenedFile | null> {
  if (!isNative()) return null;
  let p: OpenedPayload;
  try {
    p = await FileOpener.getPendingFile();
  } catch {
    return null;
  }
  if (!p?.name) return null;
  if (!p.url) throw new OpenedFileError(p.name);
  try {
    const res = await fetch(p.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const mime = p.mime || blob.type || undefined;
    return {
      file: new File([blob], p.name, mime ? { type: mime } : {}),
      name: p.name,
      ...(mime ? { mime } : {}),
    };
  } catch (e) {
    throw new OpenedFileError(p.name, e);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // chunk to avoid String.fromCharCode arg limits on big files
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Native "Save": a WebView ignores the blob-download trick, so write the bytes to
 * a temp file and hand it to the Android share/save sheet, letting the user place
 * it (Files, Drive, email, ...). The plugins load lazily so the web bundle is
 * unaffected. Returns true when it handled the save (native), false on the web so
 * the caller falls back to the File System Access API / download.
 */
export async function saveBytesNative(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (!isNative()) return false;
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const path = filename || "untitled";
  await Filesystem.writeFile({ path, data: bytesToBase64(bytes), directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: path, url: uri });
  } catch {
    // The user dismissing the share sheet rejects; that is not a save failure.
  }
  return true;
}
