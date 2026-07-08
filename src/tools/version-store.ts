import { isQuotaError, staleVersionKeys, versionIdsToDrop } from "../core/retention";

// Version snapshots for the history tool. Kept in its own IndexedDB database so it
// stays decoupled from the crash-recovery store. Snapshots are keyed by a stable
// per-document key (uri when known, else the session id). Retention: each key is
// capped (automatic snapshots dropped before deliberate ones) and keys untouched
// for months are removed wholesale, so the store cannot grow without bound.

export interface Version {
  id?: number;
  key: string;
  ts: number;
  formatId: string | null;
  label: string;
  /** Canonical text for text documents; empty for binary ones. */
  text: string;
  /** True when this snapshot holds binary bytes/state rather than text. */
  binary?: boolean;
  /** Raw bytes for binary documents whose export is cleanly re-importable (XLSX/ODS/DOCX/ODT). */
  bytes?: Uint8Array;
  /** A lossless editing-session snapshot for editors that provide one (PDF). */
  state?: unknown;
  /** Signature of `state`, for skipping unchanged snapshots without deep-comparing it. */
  stateSig?: string;
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
    try {
      await this.addRaw(version);
    } catch (e) {
      // Storage full: shed aggressively (this key down to a handful, stale keys
      // gone entirely) and retry once; the caller surfaces a second failure.
      if (!isQuotaError(e)) throw e;
      await this.pruneKey(version.key, 10);
      await this.pruneStale();
      await this.addRaw(version);
    }
    await this.pruneKey(version.key);
  }

  private async addRaw(version: Version): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(version);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Cap one document's history, dropping Auto/Opened snapshots first. */
  async pruneKey(key: string, cap?: number): Promise<void> {
    const versions = await this.listByKey(key);
    const ids = versionIdsToDrop(versions, cap);
    if (!ids.length) return;
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Remove every version of documents whose history saw nothing for months. */
  async pruneStale(): Promise<void> {
    const db = await this.db();
    const all = await new Promise<Version[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Version[]);
      req.onerror = () => reject(req.error);
    });
    const newest = new Map<string, number>();
    for (const v of all) newest.set(v.key, Math.max(newest.get(v.key) ?? 0, v.ts));
    for (const key of staleVersionKeys(newest, Date.now())) await this.deleteByKey(key);
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
