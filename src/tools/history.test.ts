import { describe, expect, it, vi } from "vitest";
import type { HostAPI, Workspace } from "../core/types";
import { AutoSnapshotTimer, bytesEqual, restoreVersion, snapshot, stateSig } from "./history";
import type { Version, VersionStore } from "./version-store";

// A minimal in-memory stand-in for VersionStore (the real one is IndexedDB-backed,
// which isn't available in the node test environment). `listCalls` is counted because
// snapshotting must NOT read the whole history: listByKey deserialises every stored byte
// buffer, and the snapshot path only ever wants the newest record.
function fakeStore(seed: Version[] = []): VersionStore & { rows: Version[]; listCalls: number } {
  const rows = [...seed];
  const store = {
    rows,
    listCalls: 0,
    async add(v: Version) {
      rows.unshift(v); // newest first, matching listByKey's ordering
    },
    async listByKey(key: string) {
      store.listCalls++;
      return rows.filter((r) => r.key === key).sort((a, b) => b.ts - a.ts);
    },
    async latestByKey(key: string) {
      return rows.filter((r) => r.key === key).sort((a, b) => b.ts - a.ts)[0];
    },
    async countByKey(key: string) {
      return rows.filter((r) => r.key === key).length;
    },
    async deleteByKey(key: string) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].key === key) rows.splice(i, 1);
    },
  };
  return store as unknown as VersionStore & { rows: Version[]; listCalls: number };
}

function fakeHost(workspace: Partial<Workspace>): HostAPI {
  // Default getActiveState to null so the bytes/text paths run unless a test opts in.
  return { workspace: { getActiveState: () => null, ...workspace } as Workspace } as unknown as HostAPI;
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
        readOnly: false,
        dirty: false,
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
        readOnly: false,
        dirty: false,
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
        readOnly: false,
        dirty: false,
      }),
      getActiveBytes: () => Promise.resolve(null),
    });
    await snapshot(host, store, "Auto");
    expect(store.rows).toHaveLength(0);
  });
});

describe("history snapshot for editors with a session state (PDF)", () => {
  it("stores the session state and dedupes by signature", async () => {
    const store = fakeStore();
    let st: { original: Uint8Array; edits: { html: string }[]; boxes: unknown[]; images: unknown[] } = {
      original: new Uint8Array([1, 2, 3]),
      edits: [{ html: "hello" }],
      boxes: [],
      images: [],
    };
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1",
        key: "k",
        uri: null,
        filename: "a.pdf",
        formatId: "pdf",
        text: "",
        binary: true,
        readOnly: false,
        dirty: false,
      }),
      getActiveState: () => st,
      getActiveBytes: () => Promise.resolve(null),
    });
    await snapshot(host, store, "Saved");
    await snapshot(host, store, "Saved"); // identical state: skipped
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].state).toBe(st);
    expect(store.rows[0].stateSig).toBe(stateSig(st));
    st = { original: new Uint8Array([1, 2, 3]), edits: [{ html: "hello world" }], boxes: [], images: [] };
    await snapshot(host, store, "Saved"); // changed edit
    expect(store.rows).toHaveLength(2);
  });

  it("signature ignores large byte buffers but reflects edit changes", () => {
    const a = { original: new Uint8Array([1, 2]), edits: [{ html: "x" }], boxes: [], images: [] };
    const b = { original: new Uint8Array([9, 9]), edits: [{ html: "x" }], boxes: [], images: [] };
    const c = { original: new Uint8Array([1, 2]), edits: [{ html: "y" }], boxes: [], images: [] };
    expect(stateSig(a)).toBe(stateSig(b)); // different bytes, same edits -> same signature
    expect(stateSig(a)).not.toBe(stateSig(c)); // different edit -> different signature
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
        readOnly: false,
        dirty: false,
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
        readOnly: false,
        dirty: false,
      }),
      getActiveBytes: () => Promise.resolve(null),
    });
    await snapshot(host, store, "Auto");
    expect(store.rows).toHaveLength(0);
  });
});

describe("history snapshot cost", () => {
  it("reads only the newest version to decide whether anything changed", async () => {
    // A document with a long history holds many megabytes; listByKey would deserialise all
    // of them on every automatic snapshot just to compare against the most recent one.
    const seed: Version[] = Array.from({ length: 40 }, (_, i) => ({
      key: "k", ts: i, formatId: "xlsx", label: "Auto", text: "", binary: true,
      bytes: new Uint8Array([i]),
    }));
    const store = fakeStore(seed);
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1", key: "k", uri: null, filename: "a.xlsx", formatId: "xlsx",
        text: "", binary: true, readOnly: false, dirty: false,
      }),
      getActiveBytes: () => Promise.resolve(new Uint8Array([99])),
    });
    await snapshot(host, store, "Auto");
    expect(store.rows).toHaveLength(41);
    expect(store.listCalls).toBe(0);
  });
});

describe("history state change count", () => {
  it("stores the count the editor reports, since only it knows its state's shape", async () => {
    const store = fakeStore();
    const state = { edits: [1], boxes: [], images: [], whiteouts: [2, 3] };
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1", key: "k", uri: null, filename: "a.pdf", formatId: "pdf",
        text: "", binary: true, readOnly: false, dirty: false,
      }),
      getActiveState: () => state,
      getActiveBytes: () => Promise.resolve(null),
      countActiveStateChanges: (s) => {
        const st = s as typeof state;
        return st.edits.length + st.boxes.length + st.images.length + st.whiteouts.length;
      },
    });
    await snapshot(host, store, "Manual");
    expect(store.rows[0].stateChanges).toBe(3);
  });

  it("leaves the count unset when the editor cannot say", async () => {
    const store = fakeStore();
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1", key: "k", uri: null, filename: "a.pdf", formatId: "pdf",
        text: "", binary: true, readOnly: false, dirty: false,
      }),
      getActiveState: () => ({ anything: true }),
      getActiveBytes: () => Promise.resolve(null),
    });
    await snapshot(host, store, "Manual");
    expect(store.rows[0].stateChanges).toBeUndefined();
  });
});

describe("history restore", () => {
  it("snapshots what is on screen before replacing it", async () => {
    // Automatic snapshots are minutes apart, so without this the restore throws away
    // everything typed since the last one with no way back.
    const store = fakeStore();
    let current = "work in progress";
    const restored: string[] = [];
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1", key: "k", uri: null, filename: "a.txt", formatId: "text",
        text: current, binary: false, readOnly: false, dirty: false,
      }),
      getActiveBytes: () => Promise.resolve(null),
      setActiveText: (text: string) => {
        restored.push(text);
        current = text;
      },
    });
    await restoreVersion(host, store, {
      key: "k", ts: 1, formatId: "text", label: "Saved", text: "an older draft",
    });
    expect(restored).toEqual(["an older draft"]);
    expect(store.rows.map((r) => [r.label, r.text])).toEqual([["BeforeRestore", "work in progress"]]);
  });

  it("captures a binary document's bytes before restoring over them", async () => {
    const store = fakeStore();
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1", key: "k", uri: null, filename: "a.xlsx", formatId: "xlsx",
        text: "", binary: true, readOnly: false, dirty: false,
      }),
      getActiveBytes: () => Promise.resolve(new Uint8Array([7, 7, 7])),
      setActiveBytes: () => {},
    });
    await restoreVersion(host, store, {
      key: "k", ts: 1, formatId: "xlsx", label: "Saved", text: "", binary: true,
      bytes: new Uint8Array([1]),
    });
    expect(store.rows[0].label).toBe("BeforeRestore");
    expect(store.rows[0].bytes).toEqual(new Uint8Array([7, 7, 7]));
  });
});

describe("AutoSnapshotTimer", () => {
  it("fires after the quiet period once editing stops", () => {
    vi.useFakeTimers();
    const fired: number[] = [];
    const timer = new AutoSnapshotTimer(() => fired.push(Date.now()), 1000, 5000);
    timer.noteChange("s1");
    vi.advanceTimersByTime(999);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fired).toHaveLength(1);
    vi.useRealTimers();
  });

  it("still fires while typing never stops, which a plain debounce never did", () => {
    // The bug this exists for: a debounce reset on every keystroke means a long
    // uninterrupted editing session produced no automatic snapshot at all.
    vi.useFakeTimers();
    let fired = 0;
    const timer = new AutoSnapshotTimer(() => fired++, 1000, 5000);
    for (let elapsed = 0; elapsed < 12_000; elapsed += 100) {
      timer.noteChange("s1"); // a keystroke every 100ms, never a 1s pause
      vi.advanceTimersByTime(100);
    }
    expect(fired).toBe(2); // one per 5s deadline, not zero
    vi.useRealTimers();
  });

  it("drops a pending snapshot when another document becomes active", () => {
    // snapshot() reads whatever document is active, so a timer armed by the previous one
    // would capture the wrong document under the wrong key.
    vi.useFakeTimers();
    let fired = 0;
    const timer = new AutoSnapshotTimer(() => fired++, 1000, 5000);
    timer.noteChange("s1");
    vi.advanceTimersByTime(900);
    timer.reset("s2"); // the user opened a different file
    vi.advanceTimersByTime(10_000);
    expect(fired).toBe(0);
    vi.useRealTimers();
  });

  it("restarts cleanly when changes arrive for a new session without a reset", () => {
    vi.useFakeTimers();
    let fired = 0;
    const timer = new AutoSnapshotTimer(() => fired++, 1000, 5000);
    timer.noteChange("s1");
    vi.advanceTimersByTime(900);
    timer.noteChange("s2"); // different document: the old quiet period must not carry over
    vi.advanceTimersByTime(900);
    expect(fired).toBe(0);
    vi.advanceTimersByTime(100);
    expect(fired).toBe(1);
    vi.useRealTimers();
  });
});

describe("history snapshot for read-only documents", () => {
  it("stores nothing for a viewer, however big the file behind it is", async () => {
    // A video opened out of an archive reaches the editor as bytes, so without this guard
    // "Opened" would put the whole file in IndexedDB to offer a restore of what is already
    // on screen, for a document that has no way to change.
    const store = fakeStore();
    let bytesRead = false;
    const host = fakeHost({
      getActiveDocument: () => ({
        sessionId: "s1",
        key: "file://clip.mp4",
        uri: "file://clip.mp4",
        filename: "clip.mp4",
        formatId: "mp4",
        text: "",
        binary: true,
        readOnly: true,
        dirty: false,
      }),
      getActiveBytes: () => {
        bytesRead = true; // the export is what costs; it must not even be asked for
        return Promise.resolve(new Uint8Array([0, 0, 0, 24]));
      },
    });
    await snapshot(host, store, "Opened");
    expect(store.rows).toHaveLength(0);
    expect(bytesRead).toBe(false);
  });
});
