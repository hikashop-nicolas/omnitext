// fake-indexeddb/auto gives the history store a real IndexedDB to run against, so the
// add / cap / quota-retry sequence (which the pure retention helpers cannot cover) is
// exercised end to end. This store never touches localStorage, so the node env is fine.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VersionStore, type Version } from "./version-store";

function ver(key: string, ts: number, label: string, over: Partial<Version> = {}): Version {
  return { key, ts, label, formatId: null, text: `v${ts}`, ...over };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("VersionStore", () => {
  it("round-trips versions for a key, newest first", async () => {
    const store = new VersionStore();
    await store.add(ver("doc", 1, "Saved"));
    await store.add(ver("doc", 3, "Manual"));
    await store.add(ver("doc", 2, "Auto"));

    const list = await store.listByKey("doc");
    expect(list.map((v) => v.ts)).toEqual([3, 2, 1]);
    // A different document's history is isolated.
    expect(await store.listByKey("other")).toEqual([]);
  });

  it("preserves binary bytes and lossless editor state", async () => {
    const store = new VersionStore();
    await store.add(ver("bin", 1, "Saved", { binary: true, bytes: new Uint8Array([9, 8, 7]), text: "" }));
    const [v] = await store.listByKey("bin");
    expect(v?.binary).toBe(true);
    expect([...(v?.bytes ?? [])]).toEqual([9, 8, 7]);
  });

  it("caps a key at the default limit, dropping the oldest and keeping the newest", async () => {
    const store = new VersionStore();
    for (let ts = 1; ts <= 102; ts++) await store.add(ver("doc", ts, "Auto"));

    const list = await store.listByKey("doc");
    expect(list.length).toBe(100); // VERSIONS_PER_KEY
    expect(list[0]!.ts).toBe(102); // the most recent add survives
    expect(list.some((v) => v.ts === 1)).toBe(false); // the oldest was dropped
    expect(list.some((v) => v.ts === 2)).toBe(false);
  });

  it("drops disposable snapshots before deliberate ones, keeping a just-added Manual", async () => {
    const store = new VersionStore();
    for (let ts = 1; ts <= 5; ts++) await store.add(ver("doc", ts, "Auto"));
    await store.add(ver("doc", 6, "Manual")); // the deliberate one the user cares about

    await store.pruneKey("doc", 2); // cap this key hard

    const list = await store.listByKey("doc");
    expect(list.length).toBe(2);
    const manual = list.find((v) => v.label === "Manual");
    expect(manual?.ts).toBe(6); // never evicted despite being newest at cap time
  });

  it("sheds and retries when the write hits quota, so the snapshot still lands", async () => {
    const store = new VersionStore();
    await store.add(ver("doc", 1, "Auto")); // something for the quota prune to shed

    const realAdd = IDBObjectStore.prototype.add;
    let thrown = false;
    const spy = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (!thrown) {
        thrown = true;
        throw new DOMException("quota", "QuotaExceededError");
      }
      return realAdd.apply(this, args as Parameters<typeof realAdd>);
    });

    await store.add(ver("doc", 2, "Manual", { text: "keep me" }));
    spy.mockRestore();

    const list = await store.listByKey("doc");
    expect(list.some((v) => v.text === "keep me")).toBe(true);
  });

  it("rethrows a non-quota write error instead of swallowing it", async () => {
    const store = new VersionStore();
    const spy = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new DOMException("boom", "UnknownError");
    });
    await expect(store.add(ver("doc", 1, "Auto"))).rejects.toBeTruthy();
    spy.mockRestore();
  });
});
