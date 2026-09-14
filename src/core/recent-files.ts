// Recently opened files, for the start screen. Only files the app can actually open again are
// remembered: a File System Access handle (Chrome/Edge) or an Android document with a lasting
// permission. An uploaded copy or an "Open with" file (temporary grant) is not.

export const RECENT_CAP = 8;

/** Chromium's file handle, as far as reopening needs it. */
export interface RecentHandle {
  name: string;
  kind?: string;
  getFile(): Promise<File>;
  isSameEntry?(other: RecentHandle): Promise<boolean>;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export type RecentEntry =
  | { id: string; name: string; openedAt: number; kind: "handle"; handle: RecentHandle }
  | { id: string; name: string; openedAt: number; kind: "android"; uri: string };

/**
 * Put `entry` first, dropping any older entry for the same file, and keep at most `cap`.
 * `same` decides identity; Android entries match by URI, handles by the caller's check.
 */
export function mergeRecent(list: RecentEntry[], entry: RecentEntry, same: (a: RecentEntry) => boolean, cap = RECENT_CAP): RecentEntry[] {
  return [entry, ...list.filter((e) => !same(e))].sort((a, b) => b.openedAt - a.openedAt).slice(0, cap);
}

const DB = "omnitext-recent";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Newest first. */
export async function listRecent(): Promise<RecentEntry[]> {
  const all = (await run<RecentEntry[]>("readonly", (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

/** Ids of the entries in `list` that are the same file as `entry`. Handles cannot be compared by value, so each one with the same name is asked. */
export async function sameFileIds(list: RecentEntry[], entry: RecentEntry): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const e of list) {
    if (entry.kind === "android") {
      if (e.kind === "android" && e.uri === entry.uri) ids.add(e.id);
    } else if (e.kind === "handle" && e.name === entry.name) {
      try {
        if (await entry.handle.isSameEntry?.(e.handle)) ids.add(e.id);
      } catch {
        /* a handle to a file that no longer exists is not the same file */
      }
    }
  }
  return ids;
}

/** Remember a file as just opened. Failures are swallowed: a recent list is never worth an error. */
/** An entry before it has an id: Omit is applied to each kind separately, so their own fields survive. */
export type NewRecent = (RecentEntry extends infer E ? (E extends RecentEntry ? Omit<E, "id" | "openedAt"> : never) : never) & { openedAt?: number };

export async function rememberRecent(entry: NewRecent): Promise<void> {
  try {
    const list = await listRecent();
    const full = { ...entry, id: crypto.randomUUID(), openedAt: entry.openedAt ?? Date.now() } as RecentEntry;
    const dupes = await sameFileIds(list, full);
    const same = (e: RecentEntry): boolean => dupes.has(e.id);
    const next = mergeRecent(list, full, same);
    const keep = new Set(next.map((e) => e.id));
    await run("readwrite", (s) => {
      for (const e of list) if (!keep.has(e.id)) s.delete(e.id);
      for (const e of next) s.put(e);
    });
  } catch (e) {
    console.warn("[omnitext] recent files not saved", e);
  }
}

export async function forgetRecent(id: string): Promise<RecentEntry | undefined> {
  const entry = await run<RecentEntry>("readonly", (s) => s.get(id));
  await run("readwrite", (s) => { s.delete(id); });
  return entry;
}

export async function getRecent(id: string): Promise<RecentEntry | undefined> {
  return run<RecentEntry>("readonly", (s) => s.get(id));
}
