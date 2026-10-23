// What the app and the media editor pass each other, kept free of mediaplay so the app's main
// chunk does not drag the player in: the app only needs to hand files over and ask whether a
// queue is playing, and the editor (which loads mediaplay anyway) fills in the rest.

/** The files of a selection, handed to the media editor that mounts for its first file. */
let handedOver: File[] | null = null;

/** Called by the app just before it opens a document that was part of a selection. */
export function handOverFiles(files: File[] | null): void {
  handedOver = files;
}

/** Called by the media editor as it mounts; whoever takes it owns it. */
export function takeHandedOverFiles(): File[] | null {
  const files = handedOver;
  handedOver = null;
  return files;
}

/** The queue that is playing, as far as the app needs to know it. */
export interface ActiveQueue {
  length(): number;
  /** The queue as M3U8 text. */
  toM3u(): string;
  /** A file name to offer when saving it. */
  suggestedName(): string;
}

let active: ActiveQueue | null = null;

export function setActiveQueue(queue: ActiveQueue | null): void {
  active = queue;
}

export function activeQueue(): ActiveQueue | null {
  return active && active.length() > 1 ? active : null;
}

/** Natural order of picked files: "ep2" before "ep10", a folder's files by their path. */
export function relativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

interface DirectoryHandle {
  name: string;
  entries(): AsyncIterable<[string, { kind: string; getFile(): Promise<File> }]>;
}

/**
 * Ask for a folder and give back its own files (subfolders are not entered). Chromium has the
 * directory picker; elsewhere a folder input does the same job. Null when cancelled.
 */
export async function pickFolderFiles(): Promise<File[] | null> {
  const win = window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandle> };
  if (win.showDirectoryPicker) {
    try {
      const dir = await win.showDirectoryPicker();
      const files: File[] = [];
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== "file") continue;
        const f = await h.getFile();
        Object.defineProperty(f, "webkitRelativePath", { value: `${dir.name}/${name}` });
        files.push(f);
      }
      return files;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.addEventListener("change", () => resolve(input.files?.length ? [...input.files] : null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}
