import { isQuotaError, staleSessionIds } from "./retention";
import type { TextEncoding } from "./types";

// Crash-recovery + autosave store. The browser store is a CACHE, not the durable copy
// (the durable copy is the user's file on disk). We snapshot the raw editor text on
// every change so a crash or a serialize-throw never loses edits.

export interface DocSnapshot {
  id: string;
  uri: string | null;
  filename: string | null;
  formatId: string | null;
  text: string;
  encoding: TextEncoding;
  updatedAt: number;
  /** Binary documents: the exported bytes (text is "" then). IndexedDB stores them natively. */
  bytes?: Uint8Array;
  binary?: boolean;
  mime?: string | null;
}

const DB_NAME = "omnitext";
const STORE = "documents";
const LAST_KEY = "omnitext:lastSessionId";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SessionStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= openDb());
  }

  async save(snap: DocSnapshot): Promise<void> {
    const db = await this.db();
    try {
      await tx(db, "readwrite", (s) => s.put(snap));
    } catch (e) {
      // Storage full: shed old crash-recovery snapshots and retry once. The
      // caller surfaces the failure if even that is not enough.
      if (!isQuotaError(e)) throw e;
      await this.prune(snap.id, 0); // age 0 = everything but the current session
      await tx(db, "readwrite", (s) => s.put(snap));
    }
    try {
      localStorage.setItem(LAST_KEY, snap.id);
    } catch {
      /* localStorage may be unavailable in private mode; ignore */
    }
  }

  /** Delete crash-recovery snapshots that are old or beyond the newest few.
      Cheap and idempotent; runs once at boot and again under quota pressure. */
  async prune(keepId: string | null = null, maxAgeMs?: number): Promise<void> {
    const db = await this.db();
    const all = await tx<DocSnapshot[]>(db, "readonly", (s) => s.getAll());
    const ids = staleSessionIds(
      all.map((d) => ({ id: d.id, updatedAt: d.updatedAt })),
      Date.now(),
      keepId,
      maxAgeMs,
    );
    for (const id of ids) await tx(db, "readwrite", (s) => s.delete(id));
  }

  async get(id: string): Promise<DocSnapshot | undefined> {
    const db = await this.db();
    return tx<DocSnapshot | undefined>(db, "readonly", (s) => s.get(id));
  }

  async loadLatest(): Promise<DocSnapshot | undefined> {
    let id: string | null = null;
    try {
      id = localStorage.getItem(LAST_KEY);
    } catch {
      /* ignore */
    }
    if (!id) return undefined;
    return this.get(id);
  }

  /** Best-effort: ask the browser to keep our storage from being evicted. */
  static async requestPersistent(): Promise<boolean> {
    if (navigator.storage?.persist) {
      try {
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    }
    return false;
  }
}
