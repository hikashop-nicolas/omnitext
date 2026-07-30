import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { AwarenessLike } from "../core/types";
import { peersAt, publishPosition, watchPeers } from "./peer-presence";

// Presence, tested against the real y-protocols Awareness rather than a stub, because the
// thing worth checking is that publishing a position does not clobber the name and colour
// that were set separately.

function person(name: string, colour: string): { awareness: AwarenessLike; real: Awareness } {
  const real = new Awareness(new Y.Doc());
  real.setLocalState({ name, colour });
  return { awareness: real as unknown as AwarenessLike, real };
}

/** Copy one peer's state into another's view of the room. */
function see(observer: Awareness, other: Awareness): void {
  observer.states.set(other.clientID, { ...other.getLocalState() } as Record<string, unknown>);
  observer.emit("update", [{ added: [other.clientID], updated: [], removed: [] }, "test"]);
}

describe("peer presence", () => {
  it("publishes a position without losing the name and colour", () => {
    const { awareness, real } = person("Ada", "#f00");
    publishPosition(awareness, { cueId: "c1" });

    expect(real.getLocalState()).toEqual({ name: "Ada", colour: "#f00", at: { cueId: "c1" } });
  });

  it("lists everyone else, never oneself", () => {
    const me = person("Ada", "#f00");
    const them = person("Grace", "#0f0");
    publishPosition(me.awareness, { cueId: "mine" });
    publishPosition(them.awareness, { cueId: "theirs" });
    see(me.real, them.real);

    const peers = peersAt<{ cueId: string }>(me.awareness);
    expect(peers).toHaveLength(1);
    expect(peers[0].name).toBe("Grace");
    expect(peers[0].colour).toBe("#0f0");
    expect(peers[0].at.cueId).toBe("theirs");
  });

  // Someone who has not touched the document has nowhere to draw. Drawing a guess would
  // be worse than drawing nothing, so they are left out.
  it("leaves out a peer that has not published a position", () => {
    const me = person("Ada", "#f00");
    const them = person("Grace", "#0f0");
    see(me.real, them.real);
    expect(peersAt(me.awareness)).toEqual([]);
  });

  it("falls back to a neutral colour rather than dropping a peer", () => {
    const me = person("Ada", "#f00");
    const them = new Awareness(new Y.Doc());
    them.setLocalState({ name: "Nameless", at: { cueId: "x" } });
    see(me.real, them);

    expect(peersAt(me.awareness)[0].colour).toBe("#888");
  });

  it("renders now and again on every change, until unwatched", () => {
    const me = person("Ada", "#f00");
    const them = person("Grace", "#0f0");
    const render = vi.fn();

    const stop = watchPeers(me.awareness, render);
    expect(render).toHaveBeenCalledTimes(1); // immediately, so nothing waits for a change

    publishPosition(them.awareness, { cueId: "c9" });
    see(me.real, them.real);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1][0][0].at).toEqual({ cueId: "c9" });

    stop();
    see(me.real, them.real);
    expect(render).toHaveBeenCalledTimes(2); // no longer listening
  });

  it("keeps a stable order, so a shared position does not flicker between colours", () => {
    const me = person("Ada", "#f00");
    const a = person("Zoe", "#00f");
    const b = person("Bob", "#0f0");
    publishPosition(a.awareness, { cueId: "same" });
    publishPosition(b.awareness, { cueId: "same" });
    see(me.real, a.real);
    see(me.real, b.real);

    const first = peersAt(me.awareness).map((p) => p.id);
    expect(peersAt(me.awareness).map((p) => p.id)).toEqual(first);
    expect(first).toEqual([...first].sort());
  });
});
