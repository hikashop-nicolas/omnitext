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
    await tx(db, "readwrite", (s) => s.put(snap));
    try {
      localStorage.setItem(LAST_KEY, snap.id);
    } catch {
      /* localStorage may be unavailable in private mode; ignore */
    }
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
