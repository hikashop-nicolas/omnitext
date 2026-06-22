import { Capacitor } from "@capacitor/core";

// Platform helpers. On the web isNative() is false, so every web code path stays
// exactly as before; the native branches only run inside the Android/iOS app.

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
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
