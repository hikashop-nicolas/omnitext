import { describe, expect, it, vi } from "vitest";
import { BlobStore } from "./blobs";
import { hashBytes } from "./base";

// Two stores talking to each other, which is the only arrangement where any of this means
// anything: a store on its own is a Map.

/** Wire a set of stores together so a send reaches the addressed ones. */
function network(names: string[], opts: { timeoutMs?: number } = {}) {
  const stores = new Map<string, BlobStore>();
  const deliver: (() => void)[] = [];
  for (const name of names) {
    stores.set(
      name,
      new BlobStore({
        peers: () => names.filter((n) => n !== name),
        timeoutMs: opts.timeoutMs ?? 50,
        send: (payload, target) => {
          const to = target === null ? names.filter((n) => n !== name) : Array.isArray(target) ? target : [target];
          const copy = payload.slice();
          for (const t of to) deliver.push(() => void stores.get(t)?.receive(copy, name));
        },
      }),
    );
  }
  /** Run the network until it goes quiet. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 50 && deliver.length; i++) {
      const batch = deliver.splice(0);
      for (const run of batch) run();
      await new Promise((r) => setTimeout(r, 0));
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { stores, settle };
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("the blob store", () => {
  it("addresses bytes by their content", async () => {
    const { stores } = network(["a"]);
    const a = stores.get("a")!;
    const first = await a.put(bytes("a picture"));
    const again = await a.put(bytes("a picture"));
    expect(again, "the same bytes are the same blob").toBe(first);
    expect(a.get(first)).toEqual(bytes("a picture"));
    expect(await a.put(bytes("a different picture"))).not.toBe(first);
  });

  it("fetches from the peer that has it", async () => {
    const { stores, settle } = network(["a", "b"]);
    const sha = await stores.get("a")!.put(bytes("shared image"));

    const pending = stores.get("b")!.fetch(sha);
    await settle();
    expect(await pending).toEqual(bytes("shared image"));
    expect(stores.get("b")!.has(sha), "and keeps it, so it is asked for once").toBe(true);
  });

  it("returns what it already holds without asking anyone", async () => {
    const { stores } = network(["a", "b"]);
    const b = stores.get("b")!;
    const sha = await b.put(bytes("already here"));
    const sent = vi.fn();
    // A fetch of something held must not touch the network at all.
    const solo = new BlobStore({ send: sent, peers: () => ["a"] });
    await solo.put(bytes("already here"));
    expect(await solo.fetch(sha)).toEqual(bytes("already here"));
    expect(sent).not.toHaveBeenCalled();
  });

  // Ten images referencing one blob must not send ten requests, and all ten callers must
  // still be answered.
  it("asks once when several callers want the same blob, and answers them all", async () => {
    const wants: string[] = [];
    let holder: BlobStore;
    const asker = new BlobStore({
      peers: () => ["holder"],
      timeoutMs: 200,
      send: (payload, target) => {
        if (payload[0] === 0) wants.push(String(target));
        const copy = payload.slice();
        setTimeout(() => void holder.receive(copy, "asker"), 0);
      },
    });
    holder = new BlobStore({
      peers: () => ["asker"],
      send: (payload) => {
        const copy = payload.slice();
        setTimeout(() => void asker.receive(copy, "holder"), 0);
      },
    });
    const sha = await holder.put(bytes("one image, wanted three times"));

    const all = await Promise.all([asker.fetch(sha), asker.fetch(sha), asker.fetch(sha)]);

    expect(wants.length, "one request, not three").toBe(1);
    for (const got of all) expect(got, "and every caller got the bytes").toEqual(bytes("one image, wanted three times"));
  });

  it("gives up rather than hanging when nobody has it", async () => {
    const { stores, settle } = network(["a", "b"], { timeoutMs: 30 });
    const missing = await hashBytes(bytes("never shared"));
    const pending = stores.get("b")!.fetch(missing);
    await settle();
    await new Promise((r) => setTimeout(r, 60));
    expect(await pending, "not yet, rather than hanging for ever").toBeNull();
  });

  it("says so at once when it does not have what was asked for", async () => {
    const answers: number[] = [];
    const a = new BlobStore({ send: (p) => answers.push(p[0]), peers: () => [] });
    await a.receive(new Uint8Array([0, 4, 100, 101, 97, 100]), "b"); // want "dead"
    expect(answers, "an answer, not silence: silence looks like a slow link").toEqual([2]);
  });

  // The address IS the content, so this is checkable rather than a matter of trust.
  it("drops bytes that do not hash to the address they arrived under", async () => {
    const store = new BlobStore({ send: () => undefined, peers: () => ["a"], timeoutMs: 40 });
    const sha = await hashBytes(bytes("the real image"));

    const pending = store.fetch(sha);
    // A data frame under the right address carrying the wrong bytes.
    const head = new TextEncoder().encode(sha);
    const wrong = bytes("something else entirely");
    const payload = new Uint8Array(2 + head.length + wrong.length);
    payload[0] = 1;
    payload[1] = head.length;
    payload.set(head, 2);
    payload.set(wrong, 2 + head.length);
    await store.receive(payload, "a");

    expect(store.has(sha), "not kept").toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(await pending, "and the fetch is not satisfied by it").toBeNull();
  });

  it("stops waiting when it is disposed", async () => {
    const store = new BlobStore({ send: () => undefined, peers: () => ["a"], timeoutMs: 5000 });
    const pending = store.fetch(await hashBytes(bytes("whatever")));
    store.dispose();
    expect(await pending).toBeNull();
  });
});
