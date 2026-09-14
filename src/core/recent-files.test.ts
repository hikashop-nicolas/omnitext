import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetRecent, listRecent, mergeRecent, RECENT_CAP, rememberRecent, sameFileIds, type RecentEntry, type RecentHandle } from "./recent-files";

const android = (uri: string, openedAt: number): RecentEntry => ({ id: uri, name: uri.split("/").pop()!, openedAt, kind: "android", uri });

/** A stand-in for Chromium's file handle: two handles are the same file when they share a path. */
const handle = (path: string): RecentHandle & { path: string } => ({
  path,
  name: path.split("/").pop()!,
  getFile: async () => new File(["x"], path.split("/").pop()!),
  isSameEntry: async (other) => (other as { path?: string }).path === path,
});

beforeEach(async () => {
  for (const e of await listRecent()) await forgetRecent(e.id);
});

describe("merging a file into the recent list", () => {
  it("puts it first and drops the older entry for the same file", () => {
    const list = [android("content://a", 3), android("content://b", 2)];
    const next = mergeRecent(list, android("content://b", 9), (e) => e.kind === "android" && e.uri === "content://b");
    expect(next.map((e) => (e as { uri: string }).uri)).toEqual(["content://b", "content://a"]);
  });

  it("keeps no more than the cap, losing the oldest", () => {
    const list = Array.from({ length: RECENT_CAP }, (_, i) => android(`content://${i}`, i));
    const next = mergeRecent(list, android("content://new", 100), () => false);
    expect(next).toHaveLength(RECENT_CAP);
    expect(next[0]!.name).toBe("new");
    expect(next.some((e) => e.name === "0"), "the oldest one went").toBe(false);
  });
});

describe("the stored recent list", () => {
  it("remembers Android documents newest first, once each", async () => {
    await rememberRecent({ kind: "android", name: "a.docx", uri: "content://docs/a", openedAt: 1 });
    await rememberRecent({ kind: "android", name: "b.xlsx", uri: "content://docs/b", openedAt: 2 });
    await rememberRecent({ kind: "android", name: "a.docx", uri: "content://docs/a", openedAt: 3 });
    const list = await listRecent();
    expect(list.map((e) => e.name)).toEqual(["a.docx", "b.xlsx"]);
  });

  it("tells two files with the same name apart, and finds the same file", async () => {
    // Real file handles are stored as they are; this stand-in has methods, which storage cannot
    // copy, so the comparison is checked on its own.
    const entry = (path: string, id: string): RecentEntry => ({ id, name: "notes.md", openedAt: 1, kind: "handle", handle: handle(path) });
    const list = [entry("/work/notes.md", "w"), entry("/home/notes.md", "h"), { ...android("content://x/notes.md", 1), id: "a" }];
    expect([...(await sameFileIds(list, entry("/work/notes.md", "new")))]).toEqual(["w"]);
    expect([...(await sameFileIds(list, entry("/tmp/notes.md", "new")))], "same name, other folder").toEqual([]);
  });

  it("forgets a file on request", async () => {
    await rememberRecent({ kind: "android", name: "a.pdf", uri: "content://docs/a", openedAt: 1 });
    const [entry] = await listRecent();
    expect((await forgetRecent(entry!.id))?.name).toBe("a.pdf");
    expect(await listRecent()).toHaveLength(0);
  });
});
