import { sniffSheetText } from "sheetedit";

/** sheetedit's own verdict on a file the quick check flagged; ext "" stands for no extension. */
export function confirmSheetExport(bytes: Uint8Array, ext: string): "html" | "spreadsheetml" | null {
  return sniffSheetText(bytes, ext || undefined);
}
