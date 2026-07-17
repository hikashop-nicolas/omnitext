// fake-indexeddb/auto supplies a real IndexedDB; a tiny in-memory shim stands in for
// localStorage (the store uses it to remember the last session id). Together they exercise
// the crash-recovery store's write / read / quota-retry paths, which hold the only copy of
// unsaved edits and were previously untested. Avoids pulling in a DOM env for two methods.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type DocSnapshot } from "./session-store";

const memStore = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

function snap(id: string, over: Partial<DocSnapshot> = {}): DocSnapshot {
  return {
    id,
    uri: null,
    filename: `${id}.txt`,
    formatId: null,
    text: `body of ${id}`,
    encoding: { label: "utf-8", bom: false },
    updatedAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  // A fresh, empty IndexedDB per test so they do not leak state into each other.
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

describe("SessionStore", () => {
  it("round-trips a snapshot through save -> get -> loadLatest", async () => {
    const store = new SessionStore();
    await store.save(snap("s1", { text: "hello world" }));

    expect((await store.get("s1"))?.text).toBe("hello world");
    // save records the id in localStorage, so loadLatest finds it with no argument.
    expect((await store.loadLatest())?.id).toBe("s1");
  });

  it("preserves binary bytes across a round-trip", async () => {
    const store = new SessionStore();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await store.save(snap("b1", { text: "", binary: true, bytes, mime: "application/octet-stream" }));

    const got = await store.get("b1");
    expect(got?.binary).toBe(true);
    expect([...(got?.bytes ?? [])]).toEqual([1, 2, 3, 250]);
  });

  it("loadLatest returns the most recently saved id, not the first", async () => {
    const store = new SessionStore();
    await store.save(snap("old"));
    await store.save(snap("new"));
    expect((await store.loadLatest())?.id).toBe("new");
  });

  it("sheds other sessions and retries when the first put hits quota, keeping the current one", async () => {
    const store = new SessionStore();
    // Seed an older, unrelated session that pruning is allowed to drop.
    await store.save(snap("stale", { updatedAt: Date.now() - 1_000_000 }));

    // Make the NEXT put throw a quota error exactly once; the retry after prune succeeds.
    const proto = IDBObjectStore.prototype;
    const realPut = proto.put;
    let thrown = false;
    const spy = vi.spyOn(proto, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (!thrown) {
        thrown = true;
        const err = new DOMException("quota", "QuotaExceededError");
        throw err;
      }
      return realPut.apply(this, args as Parameters<typeof realPut>);
    });

    await store.save(snap("current", { text: "must survive" }));
    spy.mockRestore();

    // The retry wrote the current session, and the quota prune removed the stale one.
    expect((await store.get("current"))?.text).toBe("must survive");
    expect(await store.get("stale")).toBeUndefined();
    expect((await store.loadLatest())?.id).toBe("current");
  });

  it("rethrows a non-quota write error instead of silently dropping the snapshot", async () => {
    const store = new SessionStore();
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("boom", "UnknownError");
    });
    await expect(store.save(snap("x"))).rejects.toBeTruthy();
    spy.mockRestore();
  });
});
