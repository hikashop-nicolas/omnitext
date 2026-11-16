// Another peer's clock, as an offset from ours, for things that must happen at the same
// moment on several devices (a score played in sync).
//
// Each device's performance.now() starts when its page loaded, so their values say nothing
// to each other. A ping carries our time, the reply carries the peer's; half the round trip
// is the best guess of when the peer read its clock. The sample with the shortest round trip
// is kept, because a slow one is slow on one leg more than the other and its guess is off.

const PING = 0;
const PONG = 1;
/** Samples kept per peer: the best of these is the estimate. */
const KEEP = 8;
/** A burst at the start for a good estimate quickly, then one now and then for drift. */
const BURST = 6;
const BURST_MS = 150;
const STEADY_MS = 3_000;

export interface ClockSample {
  /** Their clock minus ours, in ms. */
  offset: number;
  rtt: number;
}

/** The sample from one exchange: our send time, their time, our receive time. */
export function sampleOf(sent: number, theirs: number, received: number): ClockSample {
  return { offset: theirs - (sent + received) / 2, rtt: received - sent };
}

/** The estimate from the samples: the one with the shortest round trip. */
export function bestOf(samples: readonly ClockSample[]): ClockSample | null {
  let best: ClockSample | null = null;
  for (const s of samples) if (!best || s.rtt < best.rtt) best = s;
  return best;
}

const encode = (values: number[]): Uint8Array => new Uint8Array(new Float64Array(values).buffer);
// Copied: a received view may not sit on an 8-byte boundary.
const decode = (payload: Uint8Array): Float64Array | null =>
  payload.length % 8 === 0 && payload.length >= 24 ? new Float64Array(payload.slice().buffer) : null;

export interface ClockDeps {
  send(payload: Uint8Array, peerId: string): void;
  now(): number;
}

interface Tracked {
  samples: ClockSample[];
  timer: ReturnType<typeof setTimeout> | null;
  sent: number;
  waiting: Set<() => void>;
  users: number;
}

export class ClockSync {
  private readonly peers = new Map<string, Tracked>();
  private seq = 0;
  /** Pings in flight: sequence number to peer and send time. */
  private readonly pending = new Map<number, { peerId: string; at: number }>();

  constructor(private readonly deps: ClockDeps) {}

  /** Answers pings from anyone, and takes the answers to ours. */
  receive(payload: Uint8Array, peerId: string): void {
    const v = decode(payload);
    if (!v) return;
    if (v[0] === PING) {
      this.deps.send(encode([PONG, v[1], this.deps.now()]), peerId);
      return;
    }
    if (v[0] !== PONG) return;
    const ping = this.pending.get(v[1]);
    if (!ping || ping.peerId !== peerId) return;
    this.pending.delete(v[1]);
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const first = !peer.samples.length;
    peer.samples.push(sampleOf(ping.at, v[2], this.deps.now()));
    if (peer.samples.length > KEEP) peer.samples.shift();
    if (first) for (const f of [...peer.waiting]) f();
  }

  /** Starts measuring a peer's clock; `onFirst` runs once the first answer is in. */
  track(peerId: string, onFirst?: () => void): { dispose(): void } {
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = { samples: [], timer: null, sent: 0, waiting: new Set(), users: 0 };
      this.peers.set(peerId, peer);
      this.ping(peerId);
    }
    const p = peer;
    p.users++;
    if (onFirst) p.waiting.add(onFirst);
    let done = false;
    return {
      dispose: () => {
        if (done) return;
        done = true;
        if (onFirst) p.waiting.delete(onFirst);
        if (--p.users > 0) return;
        if (p.timer) clearTimeout(p.timer);
        this.peers.delete(peerId);
      },
    };
  }

  /** A time on the peer's clock as a time on ours, or null before any answer. */
  toLocal(peerId: string, theirs: number): number | null {
    const best = bestOf(this.peers.get(peerId)?.samples ?? []);
    return best ? theirs - best.offset : null;
  }

  /** The current estimate for a peer, for measuring. */
  estimate(peerId: string): ClockSample | null {
    return bestOf(this.peers.get(peerId)?.samples ?? []);
  }

  dispose(): void {
    for (const p of this.peers.values()) if (p.timer) clearTimeout(p.timer);
    this.peers.clear();
    this.pending.clear();
  }

  private ping(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const seq = ++this.seq;
    const at = this.deps.now();
    this.pending.set(seq, { peerId, at });
    // A ping never answered is forgotten with the next ones.
    if (this.pending.size > 64) this.pending.delete(this.pending.keys().next().value!);
    this.deps.send(encode([PING, seq, at]), peerId);
    peer.sent++;
    peer.timer = setTimeout(() => this.ping(peerId), peer.sent < BURST ? BURST_MS : STEADY_MS);
  }
}
