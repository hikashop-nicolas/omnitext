import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The native "Open with" bridge. What matters here is that the file comes across as something
// STREAMABLE: it used to arrive as base64 inside the bridge message, which cannot carry a
// video (held in memory whole, a third larger encoded, one JSON string) and failed silently,
// leaving the app on a blank document as though no file had been asked for.

const pending = vi.fn();
let native = true;

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native },
  registerPlugin: () => ({ getPendingFile: pending }),
}));

const { getOpenedFile, OpenedFileError } = await import("./platform");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  native = true;
  pending.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getOpenedFile", () => {
  it("is inert on the web", async () => {
    native = false;
    expect(await getOpenedFile()).toBeNull();
    expect(pending).not.toHaveBeenCalled();
  });

  it("is null when nothing was opened", async () => {
    pending.mockResolvedValue({});
    expect(await getOpenedFile()).toBeNull();
  });

  it("fetches the staged copy as a File, keeping the name and type", async () => {
    pending.mockResolvedValue({ name: "clip.mp4", mime: "video/mp4", url: "http://localhost/_capacitor_file_/tmp/clip.mp4" });
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "video/mp4" } })) as typeof fetch;
    const opened = (await getOpenedFile())!;
    expect(opened.name).toBe("clip.mp4");
    expect(opened.mime).toBe("video/mp4");
    // A File, not bytes: this is what lets a video stream instead of being held in memory.
    expect(opened.file).toBeInstanceOf(File);
    expect(opened.file.name).toBe("clip.mp4");
    expect(opened.file.type).toBe("video/mp4");
    expect(opened.file.size).toBe(3);
  });

  it("falls back to the blob's own type when the OS gave none", async () => {
    pending.mockResolvedValue({ name: "clip.webm", mime: "", url: "http://localhost/staged" });
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "video/webm" } })) as typeof fetch;
    expect((await getOpenedFile())!.file.type).toBe("video/webm");
  });

  it("reports a file it could not read, rather than pretending none was asked for", async () => {
    // A blank document with no explanation is how this failed before: the OS had asked for a
    // file and the app simply opened empty.
    pending.mockResolvedValue({ name: "big.mkv", mime: "video/x-matroska" }); // no url: staging failed
    await expect(getOpenedFile()).rejects.toBeInstanceOf(OpenedFileError);

    pending.mockResolvedValue({ name: "big.mkv", url: "http://localhost/gone" });
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as typeof fetch;
    await expect(getOpenedFile()).rejects.toMatchObject({ filename: "big.mkv" });
  });

  it("stays quiet when the plugin itself is unavailable", async () => {
    pending.mockRejectedValue(new Error("no such plugin"));
    expect(await getOpenedFile()).toBeNull();
  });
});
