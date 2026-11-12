import { createDocumentNative, isNative, writeDocumentNative } from "./platform";

/** Saves a file the person asked for: through the system picker in the app, as a download in a browser. */
export async function saveFile(bytes: Uint8Array, name: string, mime: string): Promise<boolean> {
  if (isNative()) {
    const picked = await createDocumentNative(name, mime);
    if (!picked) return false;
    await writeDocumentNative(picked.uri, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
