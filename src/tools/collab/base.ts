import { t } from "../../i18n";

// The base file: one immutable document, agreed at the start of a session.
//
// A session shares logical edits, not the document, so every peer needs its own copy of
// the same starting bytes before any edit means anything. This negotiates that, and its
// most important job is the refusal: a joiner with different unsaved work must never have
// it silently replaced by the host's file.
//
// The bytes travel as a single message. Trystero splits large payloads for us, so
// re-chunking here would only duplicate what it already does well.

/** Above this, warn: a big base is uploaded once per peer, from one browser. */
export const WARN_BYTES = 8 * 1024 * 1024;
/** Above this, refuse. Five peers on a 50 MB base is a quarter-gigabyte of upload. */
export const MAX_BYTES = 50 * 1024 * 1024;

const KIND = { offer: 0, request: 1, data: 2, decline: 3 } as const;

/**
 * A refusal travels as a code, not as a sentence. The two peers may be running in
 * different languages, so the side that displays the reason is the side that must word it.
 */
type Decline = { code: "dirty" } | { code: "tooLarge"; size: number };

const declineText = (d: Decline): string =>
  d.code === "dirty" ? t("collab.reasonDirty") : t("collab.reasonTooLarge", { size: d.size });

const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024);

export interface BaseDoc {
  name: string;
  bytes: Uint8Array;
  hash: string;
}

export interface Offer {
  hash: string;
  size: number;
  name: string;
}

/** SHA-256 as hex. Identifies a base, and proves the bytes arrived intact. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function frame(kind: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = kind;
  out.set(body, 1);
  return out;
}

const frameJson = (kind: number, value: unknown): Uint8Array =>
  frame(kind, textEnc.encode(JSON.stringify(value)));

export interface BaseTransferOptions {
  /** What this peer already holds, or null when it has nothing open. */
  local(): { hash: string; dirty: boolean } | null;
  /** The host's copy of the base, to serve on request. */
  serve(): Promise<BaseDoc | null>;
  /** A verified base arrived: open it. */
  accept(doc: BaseDoc): void;
  /** The offer matched what we already hold, so there is nothing to transfer. */
  alreadyHave?(): void;
  /** Anything the person needs told, refusals included. */
  report(message: string): void;
  maxBytes?: number;
  /** How long to wait on the peer we asked before trying another who offered. */
  retryMs?: number;
}

export class BaseTransfer {
  private expecting: Offer | null = null;
  /** Who we asked, so a second offer for the same file is not a second download. */
  private askedOf: string | null = null;
  /** Others who offered the same file while one transfer was in flight. */
  private readonly fallbacks: string[] = [];
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** Set once a base has been taken, so a late offer is not acted on at all. */
  private settled = false;

  constructor(
    private readonly send: (payload: Uint8Array, peerId: string | null) => void,
    private readonly opts: BaseTransferOptions,
  ) {}

  private get limit(): number {
    return this.opts.maxBytes ?? MAX_BYTES;
  }

  /** Host side: tell a peer that just joined what this session is built on. */
  async offerTo(peerId: string): Promise<void> {
    const doc = await this.opts.serve();
    if (!doc) return;
    const offer: Offer = { hash: doc.hash, size: doc.bytes.length, name: doc.name };
    this.send(frameJson(KIND.offer, offer), peerId);
  }

  async receive(payload: Uint8Array, peerId: string): Promise<void> {
    const kind = payload[0];
    const body = payload.subarray(1);

    if (kind === KIND.offer) return this.onOffer(JSON.parse(textDec.decode(body)) as Offer, peerId);
    if (kind === KIND.request) return this.onRequest(peerId);
    if (kind === KIND.data) return this.onData(body);
    if (kind === KIND.decline) {
      const decline = JSON.parse(textDec.decode(body)) as Decline;
      this.opts.report(t("collab.otherDeclined", { reason: declineText(decline) }));
    }
  }

  private onOffer(offer: Offer, peerId: string): void {
    if (this.settled) return; // we have the document; a later offer of it is nothing to do

    // More than one peer can hold the session's file, and after the person who started it
    // leaves, more than one must. Their offers all arrive; taking each would download the
    // same document once per peer, so the rest are kept only as somewhere to ask if the
    // one we chose goes quiet.
    if (this.expecting) {
      if (offer.hash === this.expecting.hash && peerId !== this.askedOf && !this.fallbacks.includes(peerId)) {
        this.fallbacks.push(peerId);
      }
      return;
    }

    const mine = this.opts.local();

    // Already the same file, the common case when both people were sent it. Nothing to
    // fetch, but the session still has to be told, or a joiner would never bind.
    if (mine && mine.hash === offer.hash) {
      this.settled = true;
      this.opts.alreadyHave?.();
      return;
    }

    if (mine?.dirty) {
      this.send(frameJson(KIND.decline, { code: "dirty" } satisfies Decline), peerId);
      this.opts.report(t("collab.declineDirty", { name: offer.name }));
      return;
    }

    if (offer.size > this.limit) {
      this.send(
        frameJson(KIND.decline, { code: "tooLarge", size: mb(offer.size) } satisfies Decline),
        peerId,
      );
      this.opts.report(t("collab.declineTooLarge", { name: offer.name, limit: mb(this.limit) }));
      return;
    }

    if (offer.size > WARN_BYTES) {
      this.opts.report(t("collab.fetching", { name: offer.name, size: mb(offer.size) }));
    }

    this.expecting = offer;
    this.askedOf = peerId;
    this.send(frame(KIND.request, new Uint8Array(0)), peerId);
    this.armRetry();
  }

  /**
   * Ask someone else if the peer we chose has not delivered.
   *
   * Without this, choosing a peer that leaves mid-transfer is a session that never opens,
   * and the person sees a connected room with an empty document and no way to say what is
   * wrong. The wait is generous: a large file over a slow link is not a failure.
   */
  private armRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      const next = this.fallbacks.shift();
      if (!next || !this.expecting || this.settled) return;
      this.askedOf = next;
      this.send(frame(KIND.request, new Uint8Array(0)), next);
      this.armRetry();
    }, this.opts.retryMs ?? 15_000);
  }

  /** Stop waiting. A session that has ended has nothing left to fetch. */
  dispose(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private async onRequest(peerId: string): Promise<void> {
    const doc = await this.opts.serve();
    if (!doc) return;
    this.send(frame(KIND.data, doc.bytes), peerId);
  }

  private async onData(bytes: Uint8Array): Promise<void> {
    const offer = this.expecting;
    if (!offer) {
      this.opts.report(t("collab.unsolicited"));
      return;
    }
    this.expecting = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;

    // Copy: the payload may be a view into a larger receive buffer.
    const copy = new Uint8Array(bytes);
    const hash = await hashBytes(copy);
    if (hash !== offer.hash) {
      this.opts.report(t("collab.damaged", { name: offer.name }));
      return;
    }
    this.settled = true;
    this.opts.accept({ name: offer.name, bytes: copy, hash });
  }
}
