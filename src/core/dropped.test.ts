import { describe, expect, it } from "vitest";
import { dropHandles } from "./dropped";

const item = (kind: string, handle?: unknown) =>
  ({ kind, ...(handle === undefined ? {} : { getAsFileSystemHandle: () => (handle instanceof Error ? Promise.reject(handle) : Promise.resolve(handle)) }) });
const drop = (...items: unknown[]) => ({ items, files: [] }) as unknown as DataTransfer;

describe("dropHandles", () => {
  it("gives each dropped file's handle, in order", async () => {
    const a = { kind: "file", name: "a.txt" };
    const b = { kind: "file", name: "b.txt" };
    expect(await dropHandles(drop(item("file", a), item("string"), item("file", b)))).toEqual([a, b]);
  });

  it("gives null where the browser has no handle or refuses one", async () => {
    expect(await dropHandles(drop(item("file"), item("file", new Error("no")), item("file", null)))).toEqual([null, null, null]);
  });
});
