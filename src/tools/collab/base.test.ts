import { describe, expect, it } from "vitest";
import { BaseTransfer, MAX_BYTES, WARN_BYTES, hashBytes, type BaseDoc } from "./base";

// Base-file negotiation.
//
// The case that matters most is the refusal. Someone joins a session while holding
// unsaved work of their own, and the only unacceptable outcome is that the host's file
// quietly replaces it. Everything else here is bookkeeping by comparison.

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

interface Side {
  transfer: BaseTransfer;
  accepted: BaseDoc[];
  reports: string[];
  outbox: { payload: Uint8Array; peerId: string | null }[];
}

function side(opts: {
  local?: { hash: string; dirty: boolean } | null;
  serves?: BaseDoc | null;
  maxBytes?: number;
}): Side {
  const accepted: BaseDoc[] = [];
  const reports: string[] = [];
  const outbox: { payload: Uint8Array; peerId: string | null }[] = [];
  const transfer = new BaseTransfer(
    (payload, peerId) => outbox.push({ payload: payload.slice(), peerId }),
    {
      local: () => opts.local ?? null,
      serve: async () => opts.serves ?? null,
      accept: (doc) => accepted.push(doc),
      report: (m) => reports.push(m),
      maxBytes: opts.maxBytes,
    },
  );
  return { transfer, accepted, reports, outbox };
}

/** Deliver everything one side queued to the other, until both are quiet. */
async function pump(a: Side, b: Side): Promise<void> {
  for (let round = 0; round < 10; round++) {
    const from = a.outbox.length ? a : b.outbox.length ? b : null;
    if (!from) return;
    const to = from === a ? b : a;
    const messages = from.outbox.splice(0);
    for (const m of messages) await to.transfer.receive(m.payload, from === a ? "a" : "b");
  }
  throw new Error("base transfer never settled");
}

const doc = async (name: string, content: string): Promise<BaseDoc> => {
  const b = bytes(content);
  return { name, bytes: b, hash: await hashBytes(b) };
};

describe("hashBytes", () => {
  it("is stable and content-addressed", async () => {
    expect(await hashBytes(bytes("hello"))).toBe(await hashBytes(bytes("hello")));
    expect(await hashBytes(bytes("hello"))).not.toBe(await hashBytes(bytes("hellp")));
  });

  it("matches the known SHA-256 of an empty input", async () => {
    expect(await hashBytes(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("BaseTransfer", () => {
  it("sends the base to a joiner holding nothing", async () => {
    const base = await doc("report.docx", "the shared document");
    const host = side({ serves: base });
    const joiner = side({ local: null });

    await host.transfer.offerTo("b");
    await pump(host, joiner);

    expect(joiner.accepted).toHaveLength(1);
    expect(joiner.accepted[0].name).toBe("report.docx");
    expect(new TextDecoder().decode(joiner.accepted[0].bytes)).toBe("the shared document");
    expect(joiner.accepted[0].hash).toBe(base.hash);
  });

  it("transfers nothing when both already hold the same file", async () => {
    const base = await doc("report.docx", "identical");
    const host = side({ serves: base });
    const joiner = side({ local: { hash: base.hash, dirty: false } });

    await host.transfer.offerTo("b");
    await pump(host, joiner);

    expect(joiner.accepted).toEqual([]);
    expect(joiner.reports).toEqual([]);
  });

  // The one that matters.
  it("refuses rather than overwrite unsaved work, and says so on both sides", async () => {
    const base = await doc("theirs.docx", "the host's document");
    const host = side({ serves: base });
    const joiner = side({ local: { hash: "a-different-hash", dirty: true } });

    await host.transfer.offerTo("b");
    await pump(host, joiner);

    expect(joiner.accepted).toEqual([]);
    expect(joiner.reports.join(" ")).toMatch(/unsaved changes/i);
    expect(joiner.reports.join(" ")).toMatch(/nothing has been replaced/i);
    expect(host.reports.join(" ")).toMatch(/could not take this document/i);
  });

  it("replaces a clean document that differs, which is the point of joining", async () => {
    const base = await doc("theirs.docx", "the host's document");
    const host = side({ serves: base });
    const joiner = side({ local: { hash: "something-else", dirty: false } });

    await host.transfer.offerTo("b");
    await pump(host, joiner);

    expect(joiner.accepted).toHaveLength(1);
  });

  it("refuses a base over the ceiling without downloading it", async () => {
    const big = { name: "huge.xlsx", bytes: new Uint8Array(200), hash: "h" };
    const host = side({ serves: big });
    const joiner = side({ local: null, maxBytes: 100 });

    await host.transfer.offerTo("b");
    await pump(host, joiner);

    expect(joiner.accepted).toEqual([]);
    expect(joiner.reports.join(" ")).toMatch(/too large/i);
    // And it never asked for the bytes.
    expect(joiner.outbox).toEqual([]);
    expect(host.reports.join(" ")).toMatch(/over the limit/i);
  });

  it("discards bytes whose hash does not match what was offered", async () => {
    const joiner = side({ local: null });
    // Offer one thing, then hand over another.
    const honest = await doc("f.txt", "expected");
    await joiner.transfer.receive(
      new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ hash: honest.hash, size: 8, name: "f.txt" }))]),
      "a",
    );
    await joiner.transfer.receive(new Uint8Array([2, ...bytes("tampered")]), "a");

    expect(joiner.accepted).toEqual([]);
    expect(joiner.reports.join(" ")).toMatch(/damaged/i);
  });

  it("ignores data it never asked for", async () => {
    const joiner = side({ local: null });
    await joiner.transfer.receive(new Uint8Array([2, ...bytes("unsolicited")]), "a");
    expect(joiner.accepted).toEqual([]);
    expect(joiner.reports.join(" ")).toMatch(/nobody asked for/i);
  });

  it("warns about a large but permitted base", async () => {
    const host = side({ serves: { name: "big.xlsx", bytes: new Uint8Array(WARN_BYTES + 1), hash: "h" } });
    const joiner = side({ local: null });
    await host.transfer.offerTo("b");
    await joiner.transfer.receive(host.outbox[0].payload, "a");
    expect(joiner.reports.join(" ")).toMatch(/may take a while/i);
  });

  it("offers nothing when the host has no document", async () => {
    const host = side({ serves: null });
    await host.transfer.offerTo("b");
    expect(host.outbox).toEqual([]);
  });

  it("has a ceiling above the warning threshold", () => {
    expect(MAX_BYTES).toBeGreaterThan(WARN_BYTES);
  });
});
