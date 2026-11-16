import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { BarLock, Transport } from "scoredit";
import type { CollabClock, CollabContext } from "../core/types";
import { localTransport, scoreBinding, type ConductedViewer } from "./score-collab";

// Two documents kept in step by hand, as the session's provider would.
function linked(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on("update", (u: Uint8Array) => Y.applyUpdate(a, u));
  return [a, b];
}

function fakeViewer() {
  const v = { lock: null as BarLock | null, followed: [] as Transport[] };
  const viewer: ConductedViewer = {
    setLock: (l) => (v.lock = l),
    follow: (t) => v.followed.push(t),
  };
  return { v, viewer };
}

// The follower's clock is 1000 ms behind the conductor's, known once tracked.
function fakeClock(self: string, known: boolean): CollabClock & { ready?: () => void } {
  const c: CollabClock & { ready?: () => void } = {
    selfId: () => self,
    track: (_peer, onFirst) => ((c.ready = onFirst), { dispose() {} }),
    toLocal: (_peer, theirs) => (known ? theirs - 1000 : null),
    estimate: () => null,
  };
  return c;
}

const ctx = (doc: Y.Doc, seed: boolean, clock: CollabClock): CollabContext => ({ doc, awareness: {} as CollabContext["awareness"], seed, readOnly: false, clock });

const reasons = { conductor: { edit: "no edit" }, follower: { play: "host plays", edit: "no edit" } };

describe("score session", () => {
  it("has the follower play what the conductor plays, on its own clock", () => {
    const [da, db] = linked();
    let emit: ((t: Transport) => void) | null = null;
    const host = fakeViewer();
    scoreBinding({ viewer: () => host.viewer, onTransport: (e) => (emit = e), current: () => ({ playing: false, time: 0, at: 0, speed: 1 }), reasons }).bind(ctx(da, true, fakeClock("H", true)));
    expect(host.v.lock).toEqual({ edit: "no edit" });

    const guest = fakeViewer();
    scoreBinding({ viewer: () => guest.viewer, onTransport: () => {}, current: () => ({ playing: false, time: 0, at: 0, speed: 1 }), reasons, now: () => 50 }).bind(ctx(db, false, fakeClock("G", true)));
    expect(guest.v.lock).toEqual(reasons.follower);
    expect(guest.v.followed.at(-1)).toEqual({ playing: false, time: 0, speed: 1, at: -1000 });

    emit!({ playing: true, time: 12, at: 5000, speed: 0.75 });
    expect(guest.v.followed.at(-1)).toEqual({ playing: true, time: 12, speed: 0.75, at: 4000 });
  });

  it("takes the moment as now until the clock is known, then places playback again", () => {
    const [da, db] = linked();
    let emit: ((t: Transport) => void) | null = null;
    scoreBinding({ viewer: () => fakeViewer().viewer, onTransport: (e) => (emit = e), current: () => ({ playing: true, time: 3, at: 100, speed: 1 }), reasons }).bind(ctx(da, true, fakeClock("H", true)));
    const guest = fakeViewer();
    let known = false;
    const clock = fakeClock("G", false);
    clock.toLocal = (_p, theirs) => (known ? theirs - 1000 : null);
    scoreBinding({ viewer: () => guest.viewer, onTransport: () => {}, current: () => ({ playing: false, time: 0, at: 0, speed: 1 }), reasons, now: () => 77 }).bind(ctx(db, false, clock));
    expect(guest.v.followed.at(-1)?.at).toBe(77);
    known = true;
    clock.ready?.();
    expect(guest.v.followed.at(-1)?.at).toBe(-900);
    expect(emit).not.toBeNull();
  });

  it("gives the controls back when the session ends", () => {
    const [, db] = linked();
    const guest = fakeViewer();
    const b = scoreBinding({ viewer: () => guest.viewer, onTransport: () => {}, current: () => ({ playing: false, time: 0, at: 0, speed: 1 }), reasons });
    b.bind(ctx(db, false, fakeClock("G", true)));
    b.unbind();
    expect(guest.v.lock).toBeNull();
  });

  it("converts the conductor's moment with the clock, or uses now", () => {
    const s = { playing: true, time: 1, at: 2000, speed: 1, peer: "H" };
    expect(localTransport(s, fakeClock("G", true), 5).at).toBe(1000);
    expect(localTransport(s, fakeClock("G", false), 5).at).toBe(5);
    expect(localTransport(s, undefined, 5).at).toBe(5);
  });
});
