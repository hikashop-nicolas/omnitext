import { Capacitor, registerPlugin } from "@capacitor/core";

// Platform helpers. On the web isNative() is false, so every web code path stays
// exactly as before; the native branches only run inside the Android/iOS app.

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// Native "Open with": the FileOpener plugin (android/.../FileOpenerPlugin.java) reads the
// file the OS handed us (a content:// URI the WebView itself cannot read) and stashes its
// bytes. We pull them via getPendingFile() on startup and on resume (a pull model avoids
// the race where an onNewIntent fires before JS has a listener).
interface OpenedPayload {
  name?: string;
  mime?: string;
  data?: string; // base64
}
interface FileOpenerPlugin {
  getPendingFile(): Promise<OpenedPayload>;
}
const FileOpener = registerPlugin<FileOpenerPlugin>("FileOpener");

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A file opened via "Open with", if one is pending (null on the web or a normal launch). */
export async function getOpenedFile(): Promise<OpenedFile | null> {
  if (!isNative()) return null;
  try {
    const p = await FileOpener.getPendingFile();
    return p?.data && p.name ? { name: p.name, bytes: bytesFromBase64(p.data) } : null;
  } catch {
    return null;
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
