// Version snapshots for the history tool. Kept in its own IndexedDB database so it
// stays decoupled from the crash-recovery store. Snapshots are keyed by a stable
// per-document key (uri when known, else the session id).

export interface Version {
  id?: number;
  key: string;
  ts: number;
  formatId: string | null;
  label: string;
  text: string;
}

const DB_NAME = "omnitext-history";
const STORE = "versions";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("key", "key", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class VersionStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= openDb());
  }

  async add(version: Version): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(version);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Versions for a key, newest first. */
  async listByKey(key: string): Promise<Version[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).index("key").getAll(key);
      req.onsuccess = () => resolve((req.result as Version[]).sort((a, b) => b.ts - a.ts));
      req.onerror = () => reject(req.error);
    });
  }

  async deleteByKey(key: string): Promise<void> {
    const db = await this.db();
    const versions = await this.listByKey(key);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const v of versions) if (v.id !== undefined) store.delete(v.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
