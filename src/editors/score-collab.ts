import type * as Y from "yjs";
import type { BarLock, Transport } from "scoredit";
import type { CollabBinding, CollabClock, CollabContext } from "../core/types";
import { debug, debugEnabled } from "../core/debug";

// A score in a shared session: the person who shared it conducts, everyone else follows.
//
// Only playback travels: where it is, whether it plays, at what speed. Which parts a device
// shows, its zoom and its layout stay its own, so the guitarist can show only the guitar.
// Editing is off for everyone while the score is shared (editing together comes later).
//
// The conductor's state is one entry in a shared map, rewritten on each change. Its `at` is a
// moment on the conductor's clock; each follower turns it into its own with the session's
// clock measurements, which is what lets every device sound the same note at once.

export const TRANSPORT = "score.transport";
const STATE = "state";

/** What the conductor writes: the playback, and whose clock `at` is on. */
export interface SharedTransport extends Transport {
  peer: string;
}

/** The part of the score viewer a session drives. */
export interface ConductedViewer {
  setLock(lock: BarLock | null): void;
  follow(t: Transport): void;
  /** How late this device sounds the followed playback, ms (for measuring). */
  readonly followLag?: number | null;
  /** Follow decisions since the last call and the audio clocks, for measuring. */
  followDebug?(): unknown;
}

export interface ScoreCollabDeps {
  viewer(): ConductedViewer | null;
  /** Hands the conductor's playback changes to `emit` (null: stop). */
  onTransport(emit: ((t: Transport) => void) | null): void;
  /** The current playback, written when the session starts. */
  current(): Transport;
  /** Tooltips for the controls greyed out. */
  reasons: { conductor: BarLock; follower: BarLock };
  now?(): number;
}

/** The follower's view of a shared state: `at` on its own clock, or now when the clock is not known yet. */
export function localTransport(s: SharedTransport, clock: CollabClock | undefined, now: number): Transport {
  const at = clock?.toLocal(s.peer, s.at) ?? now;
  return { playing: s.playing, time: s.time, speed: s.speed, at };
}

export function scoreBinding(deps: ScoreCollabDeps): CollabBinding {
  let cleanup: (() => void) | null = null;
  return {
    bind(ctx: CollabContext) {
      const map = ctx.doc.getMap(TRANSPORT) as Y.Map<SharedTransport>;
      const viewer = deps.viewer();
      if (!viewer) return;
      const now = deps.now ?? (() => performance.now());
      const origin = {};

      if (ctx.seed) {
        viewer.setLock(deps.reasons.conductor);
        const write = (t: Transport) => {
          const peer = ctx.clock?.selfId() ?? "";
          ctx.doc.transact(() => map.set(STATE, { ...t, peer }), origin);
        };
        deps.onTransport(write);
        write(deps.current());
        cleanup = () => {
          deps.onTransport(null);
          viewer.setLock(null);
        };
        return;
      }

      viewer.setLock(deps.reasons.follower);
      let tracking: { peer: string; dispose(): void } | null = null;
      const apply = () => {
        const s = map.get(STATE);
        if (!s) return;
        if (ctx.clock && tracking?.peer !== s.peer) {
          tracking?.dispose();
          // Placed again once the clock is known: until then `at` was taken as now.
          const t = ctx.clock.track(s.peer, () => apply());
          tracking = { peer: s.peer, dispose: () => t.dispose() };
        }
        deps.viewer()?.follow(localTransport(s, ctx.clock, now()));
      };
      const observer = () => apply();
      map.observe(observer);
      apply();
      // ?debug=sync: the follower's lag behind the conductor and the clock estimate it rests on.
      const report = debugEnabled("sync")
        ? setInterval(() => {
            const s = map.get(STATE);
            if (!s?.playing) return;
            const est = ctx.clock?.estimate(s.peer);
            const detail = deps.viewer()?.followDebug?.();
            debug("sync", "following", () => ({ offsetMs: est && Math.round(est.offset * 10) / 10, rttMs: est && Math.round(est.rtt * 10) / 10, ...(detail as object) }));
          }, 2000)
        : null;
      cleanup = () => {
        if (report) clearInterval(report);
        map.unobserve(observer);
        tracking?.dispose();
        viewer.setLock(null);
      };
    },
    unbind() {
      cleanup?.();
      cleanup = null;
    },
  };
}
