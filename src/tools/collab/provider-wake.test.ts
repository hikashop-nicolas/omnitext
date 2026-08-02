import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollabProvider } from "./provider";
import type { Channel, CollabTransport, MessageHandler, PeerHandler } from "./transport";

// Coming back to a tab that was in the background.
//
// A hidden tab is throttled and a frozen one runs no timers at all, so the periodic
// state-vector comparison that repairs a gap may not have run for as long as the person
// was away. Nothing is lost by that: whenever the vectors are next compared both sides
// catch up, which provider.test.ts covers. What it costs is the wait for the next tick,
// and during it someone is reading, and may be typing into, a document that stopped being
// true while they were gone. So the moment the tab is looked at again, ask.
//
// The suite runs without a DOM and this behaviour is a DOM event, so document and window
// are stood up here as the event targets they are. That is all the provider asks of them.

/** Records what went out, and reports a peer so that sending is worth doing at all. */
function recorder(): { transport: CollabTransport; sent: Channel[] } {
  const sent: Channel[] = [];
  const transport: CollabTransport = {
    selfId: "self",
    send: (channel) => void sent.push(channel),
    onMessage: (_h: MessageHandler) => undefined,
    onPeerJoin: (_h: PeerHandler) => undefined,
    onPeerLeave: (_h: PeerHandler) => undefined,
    peers: () => ["other"],
    close: async () => undefined,
  };
  return { transport, sent };
}

type Globals = { document?: unknown; window?: unknown };

beforeEach(() => {
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  doc.visibilityState = "visible";
  (globalThis as Globals).document = doc;
  (globalThis as Globals).window = new EventTarget();
});

afterEach(() => {
  delete (globalThis as Globals).document;
  delete (globalThis as Globals).window;
});

const becomeVisible = (): void => void document.dispatchEvent(new Event("visibilitychange"));

describe("asking again on the way back", () => {
  it("asks for what it missed as soon as the tab is looked at", () => {
    const { transport, sent } = recorder();
    const provider = new CollabProvider(transport);
    sent.length = 0;

    becomeVisible();

    expect(sent, "a state vector went out at once").toContain("sync");
    void provider;
  });

  it("asks when the network comes back", () => {
    const { transport, sent } = recorder();
    const provider = new CollabProvider(transport);
    sent.length = 0;

    window.dispatchEvent(new Event("online"));

    expect(sent).toContain("sync");
    void provider;
  });

  // Leaving the listeners behind is not visible in what goes out, because a provider that
  // has been destroyed answers nothing anyway. It still matters: a page that opens and
  // leaves sessions all day would accumulate one of each per session, all of them holding
  // a dead provider. So this counts them rather than watching the network.
  it("takes its listeners off on the way out", async () => {
    const added: string[] = [];
    const removed: string[] = [];
    for (const target of [document, window] as EventTarget[]) {
      const addFn = target.addEventListener.bind(target);
      const removeFn = target.removeEventListener.bind(target);
      target.addEventListener = (t, l, o) => { added.push(t); addFn(t, l, o); };
      target.removeEventListener = (t, l, o) => { removed.push(t); removeFn(t, l, o); };
    }

    const { transport } = recorder();
    const provider = new CollabProvider(transport);
    expect(added).toEqual(["visibilitychange", "online"]);

    await provider.destroy();
    expect(removed, "both, and nothing left holding a provider that has gone").toEqual([
      "visibilitychange",
      "online",
    ]);
  });

  // Going away is not the moment to ask: nobody is looking, and the tick covers it.
  it("says nothing when the tab is hidden", () => {
    const { transport, sent } = recorder();
    const provider = new CollabProvider(transport);
    sent.length = 0;
    (document as unknown as { visibilityState: string }).visibilityState = "hidden";

    becomeVisible();

    expect(sent).toEqual([]);
    void provider;
  });

  it("says nothing once the session has ended", async () => {
    const { transport, sent } = recorder();
    const provider = new CollabProvider(transport);
    await provider.destroy();
    sent.length = 0;

    becomeVisible();
    window.dispatchEvent(new Event("online"));

    expect(sent, "a provider that has left is not still on the network").toEqual([]);
  });
});
