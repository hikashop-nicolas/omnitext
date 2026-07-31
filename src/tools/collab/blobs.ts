import { hashBytes } from "./base";
import { debug } from "../../core/debug";

// Content-addressed bytes, fetched from whoever has them.
//
// Some edits carry payloads rather than text: an image pasted into a PDF is the first, and
// it does not belong in the CRDT. A CRDT never forgets, so an image inserted and then
// deleted would weigh on the session for as long as it lasts, and every peer would carry
// every image anyone ever tried. Instead the shared document holds a hash, and the bytes
// travel here, once, to whoever actually needs them.
//
// Addressing by content rather than by name is what makes that safe: the same image pasted
// twice costs one transfer, a peer can verify what arrived is what was asked for, and a
// blob is immutable, so there is no version of it to disagree about.
//
// No chunking. Trystero splits large payloads already, and re-chunking here would only
// duplicate what it does well; the same reasoning as the base transfer.

/** Above this, refuse: a blob is uploaded once per peer that asks, from one browser. */
export const MAX_BLOB_BYTES = 16 * 1024 * 1024;

const KIND = { want: 0, data: 1, missing: 2 } as const;

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

/** want/missing carry a hash; data carries the hash then the bytes. */
function frame(kind: number, sha: string, bytes?: Uint8Array): Uint8Array {
  const head = textEnc.encode(sha);
  const out = new Uint8Array(2 + head.length + (bytes?.length ?? 0));
  out[0] = kind;
  out[1] = head.length;
  out.set(head, 2);
  if (bytes) out.set(bytes, 2 + head.length);
  return out;
}

function unframe(payload: Uint8Array): { kind: number; sha: string; bytes: Uint8Array } {
  const headLen = payload[1] ?? 0;
  return {
    kind: payload[0] ?? -1,
    sha: textDec.decode(payload.subarray(2, 2 + headLen)),
    bytes: payload.subarray(2 + headLen),
  };
}

export interface BlobDeps {
  send(payload: Uint8Array, target: string | string[] | null): void;
  /** Who to ask. Called each time, so a peer that joined late is still asked. */
  peers(): string[];
  /** How long to wait for an answer before giving up on a blob. */
  timeoutMs?: number;
}

export class BlobStore {
  private readonly mine = new Map<string, Uint8Array>();
  /** Fetches in flight, so ten images referencing one blob ask for it once. */
  private readonly waiting = new Map<string, { resolve(b: Uint8Array | null): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly timeoutMs: number;

  constructor(private readonly deps: BlobDeps) {
    this.timeoutMs = deps.timeoutMs ?? 20_000;
  }

  /** Keep bytes and return their address. Idempotent: the same bytes give the same hash. */
  async put(bytes: Uint8Array): Promise<string> {
    const sha = await hashBytes(bytes);
    if (!this.mine.has(sha)) this.mine.set(sha, bytes);
    return sha;
  }

  /** What we hold under this address, or undefined. */
  get(sha: string): Uint8Array | undefined {
    return this.mine.get(sha);
  }

  has(sha: string): boolean {
    return this.mine.has(sha);
  }

  /**
   * The bytes at this address, asking the other peers if we do not have them.
   *
   * Resolves null when nobody answers in time, which the caller must treat as "not yet"
   * rather than "never": the peer holding it may simply not be here at the moment.
   */
  async fetch(sha: string): Promise<Uint8Array | null> {
    const held = this.mine.get(sha);
    if (held) return held;

    const already = this.waiting.get(sha);
    if (already) return new Promise((resolve) => void this.chain(sha, resolve));

    const peers = this.deps.peers();
    if (!peers.length) return null;

    debug("wire", "asking for a blob", () => ({ sha: sha.slice(0, 8), from: peers.length }));
    return new Promise<Uint8Array | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(sha);
        debug("wire", "nobody had the blob", () => sha.slice(0, 8));
        resolve(null);
      }, this.timeoutMs);
      this.waiting.set(sha, { resolve, timer });
      this.deps.send(frame(KIND.want, sha), peers);
    });
  }

  /** Add a second waiter to a fetch already in flight. */
  private chain(sha: string, resolve: (b: Uint8Array | null) => void): void {
    const entry = this.waiting.get(sha);
    if (!entry) return void resolve(this.mine.get(sha) ?? null);
    const first = entry.resolve;
    entry.resolve = (b) => {
      first(b);
      resolve(b);
    };
  }

  /** A blob message from a peer. */
  async receive(payload: Uint8Array, peerId: string): Promise<void> {
    const { kind, sha, bytes } = unframe(payload);

    if (kind === KIND.want) {
      const held = this.mine.get(sha);
      // Answer either way. Silence is indistinguishable from a slow link, and would make
      // the asker wait out its whole timeout to learn something we knew immediately.
      this.deps.send(held ? frame(KIND.data, sha, held) : frame(KIND.missing, sha), peerId);
      return;
    }

    const entry = this.waiting.get(sha);
    if (!entry) return; // not ours, or already resolved

    if (kind === KIND.missing) {
      // Another peer may still have it, so one "no" is not the answer; let the timeout
      // decide. Answering null here would give up on the first peer that happened to reply.
      return;
    }
    if (kind !== KIND.data) return;

    const copy = bytes.slice();
    // Verify. The address IS the content, so bytes that do not hash to it are not the
    // blob that was asked for, whether through corruption or a peer sending something else.
    const actual = await hashBytes(copy);
    if (actual !== sha) {
      debug("wire", "a blob did not match its hash, dropped", () => ({ sha: sha.slice(0, 8), peerId }));
      return;
    }
    clearTimeout(entry.timer);
    this.waiting.delete(sha);
    this.mine.set(sha, copy);
    entry.resolve(copy);
  }

  /** Stop waiting on anything still in flight. */
  dispose(): void {
    for (const [, entry] of this.waiting) {
      clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this.waiting.clear();
  }
}
