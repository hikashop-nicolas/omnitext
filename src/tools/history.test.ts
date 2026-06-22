import { describe, expect, it } from "vitest";
import type { HostAPI, Workspace } from "../core/types";
import { bytesEqual, snapshot } from "./history";
import type { Version, VersionStore } from "./version-store";

// A minimal in-memory stand-in for VersionStore (the real one is IndexedDB-backed,
// which isn't available in the node test environment).
function fakeStore(seed: Version[] = []): VersionStore & { rows: Version[] } {
  const rows = [...seed];
  return {
    rows,
    async add(v: Version) {
      rows.unshift(v); // newest first, matching listByKey's ordering
    },
    async listByKey(key: string) {
      return rows.filter((r) => r.key === key).sort((a, b) => b.ts - a.ts);
    },
    async deleteByKey(key: string) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].key === key) rows.splice(i, 1);
    },
  } as unknown as VersionStore & { rows: Version[] };
}

function fakeHost(workspace: Partial<Workspace>): HostAPI {
  return { workspace: workspace as Workspace } as unknown as HostAPI;
}

describe("history bytesEqual", () => {
  it("compares byte content, not identity", () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(bytesEqual(undefined, new Uint8Array([1]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), undefined)).toBe(false);
  });
});

describe("history snapshot for binary documents", () => {
  it("snapshots the bytes of a binary document (text-based guard would skip it)", async () => {
    const store = fakeStore();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1",
        key: "file://a.pdf",
        uri: "file://a.pdf",
        filename: "a.pdf",
        formatId: "pdf",
        text: "", // binary editors report empty text
        binary: true,
      }),
      getActiveBytes: () => Promise.resolve(bytes),
    });
    await snapshot(host, store, "Saved");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].binary).toBe(true);
    expect(store.rows[0].bytes).toEqual(bytes);
    expect(store.rows[0].label).toBe("Saved");
  });

  it("dedupes identical bytes but records a changed one", async () => {
    const store = fakeStore();
    let current = new Uint8Array([1, 2, 3]);
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1",
        key: "k",
        uri: null,
        filename: "a.pdf",
        formatId: "pdf",
        text: "",
        binary: true,
      }),
      getActiveBytes: () => Promise.resolve(current),
    });
    await snapshot(host, store, "Auto");
    await snapshot(host, store, "Auto"); // identical bytes: skipped
    expect(store.rows).toHaveLength(1);
    current = new Uint8Array([1, 2, 3, 4]); // changed
    await snapshot(host, store, "Auto");
    expect(store.rows).toHaveLength(2);
  });

  it("skips when there are no bytes to capture", async () => {
    const store = fakeStore();
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1",
        key: "k",
        uri: null,
        filename: "a.pdf",
        formatId: "pdf",
        text: "",
        binary: true,
      }),
      getActiveBytes: () => Promise.resolve(null),
    });
    await snapshot(host, store, "Auto");
    expect(store.rows).toHaveLength(0);
  });
});

describe("history snapshot for text documents", () => {
  it("still snapshots text and dedupes unchanged text", async () => {
    const store = fakeStore();
    let text = "hello";
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1",
        key: "k",
        uri: null,
        filename: "a.txt",
        formatId: "text",
        text,
        binary: false,
      }),
      getActiveBytes: () => Promise.resolve(null),
    });
    await snapshot(host, store, "Saved");
    await snapshot(host, store, "Saved"); // unchanged
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].text).toBe("hello");
    text = "hello world";
    await snapshot(host, store, "Saved");
    expect(store.rows).toHaveLength(2);
  });

  it("skips empty/whitespace-only text", async () => {
    const store = fakeStore();
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1",
        key: "k",
        uri: null,
        filename: null,
        formatId: null,
        text: "   \n  ",
        binary: false,
      }),
      getActiveBytes: () => Promise.resolve(null),
    });
    await snapshot(host, store, "Auto");
    expect(store.rows).toHaveLength(0);
  });
});
