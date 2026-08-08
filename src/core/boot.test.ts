import { describe, expect, it } from "vitest";
import { bootDocument, type BootSources } from "./boot";

interface Rig {
  sources: BootSources<string>;
  mounted: string[];
  /** Stand in for the launch queue handing a file over. */
  claim: (opened?: boolean) => void;
}

function rig(over: Partial<BootSources<string>> = {}): Rig {
  const mounted: string[] = [];
  let pending: Promise<boolean> | null = null;
  const sources: BootSources<string> = {
    osOpen: () => pending,
    openers: [],
    loadSnapshot: async () => null,
    mountSnapshot: async (s) => {
      mounted.push(`snapshot:${s}`);
      return true;
    },
    mountBlank: async () => {
      mounted.push("blank");
    },
    ...over,
  };
  return {
    sources,
    mounted,
    claim: (opened = true) => {
      pending = Promise.resolve(opened);
      if (opened) mounted.push("os-file");
    },
  };
}

describe("bootDocument", () => {
  it("recovers the last snapshot when the OS asked for nothing", async () => {
    const r = rig({ loadSnapshot: async () => "last" });
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["snapshot:last"]);
  });

  it("falls back to a blank document with no snapshot", async () => {
    const r = rig();
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["blank"]);
  });

  it("falls back to a blank document when the snapshot was not worth restoring", async () => {
    const r = rig({ loadSnapshot: async () => "viewer", mountSnapshot: async () => false });
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["blank"]);
  });

  it("stops at the first opener that took the screen", async () => {
    const later: string[] = [];
    const r = rig({
      openers: [
        async () => true,
        async () => {
          later.push("polled");
          return false;
        },
      ],
      loadSnapshot: async () => "last",
    });
    await bootDocument(r.sources);
    expect(later).toEqual([]);
    expect(r.mounted).toEqual([]);
  });

  // The regression this module exists for. The launch queue delivers mid-boot, so the
  // claim has to be re-read after each await; sampling it once at the top passes every
  // test above and fails each of these three.
  it("keeps an Open-with file that arrives while the snapshot is loading", async () => {
    const r = rig();
    r.sources.loadSnapshot = async () => {
      r.claim();
      return "last";
    };
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["os-file"]);
  });

  it("keeps an Open-with file that arrives while an opener is running", async () => {
    const r = rig({ loadSnapshot: async () => "last" });
    r.sources.openers = [
      async () => {
        r.claim();
        return false; // this opener found nothing; the launch queue did
      },
    ];
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["os-file"]);
  });

  it("keeps an Open-with file that arrived before boot even started", async () => {
    const r = rig({ loadSnapshot: async () => "last" });
    r.claim();
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["os-file"]);
  });

  // Awaiting the answer rather than treating a pending open as done: a file the OS asked
  // for but that could not be read must still leave a document on screen.
  it("mounts the fallback when the Open-with file could not be read", async () => {
    const r = rig({ loadSnapshot: async () => "last" });
    r.claim(false);
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["snapshot:last"]);
  });

  it("mounts a blank document when an unreadable Open-with file has nothing to recover", async () => {
    const r = rig();
    r.claim(false);
    await bootDocument(r.sources);
    expect(r.mounted).toEqual(["blank"]);
  });
});
