import type { AwarenessLike } from "../core/types";
import { debug } from "../core/debug";

// Reading and writing "where is everyone" through the presence channel.
//
// Every binding needs the same two things: publish this peer's position, and be told the
// others' positions with a colour and a name. Only the shape of a position differs, so
// that is the only thing left to the caller.

/** What a peer publishes about where it is. Editor-specific and opaque here. */
export type Position = unknown;

export interface PeerAt<P = Position> {
  /** Stable for the life of a peer's session: its Yjs client id, as a string. */
  id: string;
  name: string;
  colour: string;
  at: P;
}

/** The awareness field positions travel in. Named so it cannot collide with `user`. */
const FIELD = "at";

/** Publish where this peer is. Merges into the presence state rather than replacing it. */
export function publishPosition(awareness: AwarenessLike, at: Position): void {
  awareness.setLocalStateField(FIELD, at);
}

/**
 * Everyone else, with a position. Peers with none are left out: someone who has not
 * touched the document yet has no position to draw, and drawing a guess would be worse
 * than drawing nothing.
 */
export function peersAt<P = Position>(awareness: AwarenessLike): PeerAt<P>[] {
  const out: PeerAt<P>[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const s = state as { name?: unknown; colour?: unknown; at?: unknown };
    if (typeof s?.name !== "string" || s.at == null) continue;
    out.push({
      id: String(clientId),
      name: s.name,
      colour: typeof s.colour === "string" ? s.colour : "#888",
      at: s.at as P,
    });
  }
  // Stable order, so a repaint does not shuffle which colour wins on a shared cell.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Call `render` with everyone else's position now, and again whenever it changes.
 * Returns the unsubscribe.
 */
export function watchPeers<P = Position>(
  awareness: AwarenessLike,
  render: (peers: PeerAt<P>[]) => void,
): () => void {
  const update = (): void => {
    const peers = peersAt<P>(awareness);
    debug("peers", `${peers.length} other peer(s)`, () => peers);
    render(peers);
  };
  awareness.on("update", update);
  update();
  return () => awareness.off("update", update);
}
