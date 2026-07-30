import { joinRoom, selfId, type MessageAction, type Room } from "trystero";

// The network under a collaboration session.
//
// The provider is written against the CollabTransport interface rather than against
// Trystero directly. That buys two things: the convergence tests drive it with an
// in-memory transport and no network at all, and changing signalling strategy (nostr for
// mqtt, or a self-hosted relay) touches this file and nothing else.

/** The two message streams a session needs, kept apart so neither carries a type tag. */
export type Channel = "sync" | "awareness";

export type MessageHandler = (channel: Channel, payload: Uint8Array, peerId: string) => void;
export type PeerHandler = (peerId: string) => void;

export interface CollabTransport {
  /** The id this peer is known by to the others. */
  readonly selfId: string;
  /** Send to one peer, to a chosen set, or to every peer when target is null. */
  send(channel: Channel, payload: Uint8Array, target: string | string[] | null): void;
  onMessage(handler: MessageHandler): void;
  onPeerJoin(handler: PeerHandler): void;
  onPeerLeave(handler: PeerHandler): void;
  peers(): string[];
  close(): Promise<void>;
}

/** Namespaces the two actions. Trystero encodes these into every frame, so keep them short. */
const SYNC = "ysync";
const AWARE = "yaware";

/** Namespaces the rooms so an id cannot collide with another Trystero app's. */
export const APP_ID = "omnitext-collab";

/** Sent as a view, delivered as a buffer. */
type Wire = ArrayBuffer | Uint8Array;

/** Trystero hands binary back as an ArrayBuffer; Yjs wants a view. */
const asBytes = (d: Wire): Uint8Array => (d instanceof Uint8Array ? d : new Uint8Array(d));

export interface RoomOptions {
  roomId: string;
  /**
   * The shared secret from the link. Trystero encrypts the session descriptions with it,
   * so it is what stops someone who learns the room id from completing a connection.
   */
  secret: string;
  appId?: string;
  /** Escape hatch for tests and for pointing at a self-hosted relay. */
  relayUrls?: string[];
}

export function trysteroTransport(opts: RoomOptions): CollabTransport {
  const room: Room = joinRoom(
    {
      appId: opts.appId ?? APP_ID,
      password: opts.secret,
      ...(opts.relayUrls ? { relayConfig: { urls: opts.relayUrls } } : {}),
    },
    opts.roomId,
  );

  const actions: Record<Channel, MessageAction<Wire>> = {
    sync: room.makeAction<Wire>(SYNC),
    awareness: room.makeAction<Wire>(AWARE),
  };

  // Every hook fans out to a list. Trystero's own onPeerJoin/onPeerLeave are single
  // slots, so assigning them directly would let a second subscriber silently unhook the
  // provider's handshake.
  const handlers: MessageHandler[] = [];
  const joined: PeerHandler[] = [];
  const left: PeerHandler[] = [];

  for (const channel of ["sync", "awareness"] as const) {
    actions[channel].onMessage = (data, { peerId }) => {
      const payload = asBytes(data);
      for (const h of handlers) h(channel, payload, peerId);
    };
  }
  room.onPeerJoin = (peerId) => joined.forEach((h) => h(peerId));
  room.onPeerLeave = (peerId) => left.forEach((h) => h(peerId));

  return {
    selfId,
    send(channel, payload, target) {
      if (Array.isArray(target) && !target.length) return;
      // Fire and forget: a peer that vanished mid-send is a normal event, not an error,
      // and the sync protocol recovers on the next connection.
      void actions[channel].send(payload, target ? { target } : undefined)
        .catch(() => undefined);
    },
    onMessage: (handler) => void handlers.push(handler),
    onPeerJoin: (handler) => void joined.push(handler),
    onPeerLeave: (handler) => void left.push(handler),
    peers: () => Object.keys(room.getPeers()),
    close: () => room.leave(),
  };
}
