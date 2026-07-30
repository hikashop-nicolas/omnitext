import type { Channel, CollabTransport, MessageHandler, PeerHandler } from "./transport";

// A transport for tabs of the same browser, over BroadcastChannel.
//
// Its reason to exist is testing. The real transport pairs two peers through a public
// nostr relay, which takes anywhere between about 13 and 26 seconds and sometimes does not
// manage it at all. That is fine for what it is and hopeless as a way to check whether a
// caret shows up in the right place: most of a session's behaviour has nothing to do with
// how the two found each other.
//
// So this pairs instantly and exercises everything above the transport: the session, the
// base transfer, the CRDT, presence, the bindings. What it deliberately does NOT exercise
// is the transport itself, which is why it is opt-in rather than the default on localhost.
// Proving WebRTC works is the other test, and it needs the real thing.
//
// Same browser only: BroadcastChannel does not cross browsers, let alone machines.

interface Hello {
  t: "hello" | "welcome" | "bye";
  from: string;
}

interface Payload {
  t: "msg";
  from: string;
  /** null means everyone. */
  to: string | string[] | null;
  channel: Channel;
  data: Uint8Array;
}

type Wire = Hello | Payload;

const PREFIX = "omnitext-collab-local:";

/** Random enough to tell two tabs apart, which is all an id has to do here. */
function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function localTransport(roomId: string): CollabTransport {
  const selfId = newId();
  const bus = new BroadcastChannel(PREFIX + roomId);
  const peers = new Set<string>();
  const handlers: MessageHandler[] = [];
  const joined: PeerHandler[] = [];
  const left: PeerHandler[] = [];
  let closed = false;

  const meet = (id: string): void => {
    if (id === selfId || peers.has(id)) return;
    peers.add(id);
    for (const h of joined) h(id);
  };

  bus.onmessage = (e: MessageEvent<Wire>) => {
    if (closed) return;
    const msg = e.data;
    if (msg.from === selfId) return; // BroadcastChannel does not echo, but be explicit

    if (msg.t === "hello") {
      meet(msg.from);
      bus.postMessage({ t: "welcome", from: selfId } satisfies Hello); // so they learn about us
      return;
    }
    if (msg.t === "welcome") return void meet(msg.from);
    if (msg.t === "bye") {
      if (peers.delete(msg.from)) for (const h of left) h(msg.from);
      return;
    }
    if (msg.t !== "msg") return;

    const to = msg.to;
    const forUs = to === null || (Array.isArray(to) ? to.includes(selfId) : to === selfId);
    if (!forUs) return;
    meet(msg.from); // a message from someone we have not met is still a peer
    for (const h of handlers) h(msg.channel, msg.data, msg.from);
  };

  // Announce after the caller has had a chance to subscribe, so the first join is not lost.
  queueMicrotask(() => {
    if (!closed) bus.postMessage({ t: "hello", from: selfId } satisfies Hello);
  });

  return {
    selfId,
    send(channel, payload, target) {
      if (closed) return;
      if (Array.isArray(target) && !target.length) return;
      // Copy: the encoder reuses its buffer, and the clone happens asynchronously.
      bus.postMessage({ t: "msg", from: selfId, to: target, channel, data: payload.slice() } satisfies Payload);
    },
    onMessage: (h) => void handlers.push(h),
    onPeerJoin: (h) => void joined.push(h),
    onPeerLeave: (h) => void left.push(h),
    peers: () => [...peers],
    close: async () => {
      if (closed) return;
      closed = true;
      bus.postMessage({ t: "bye", from: selfId } satisfies Hello);
      bus.close();
    },
  };
}
