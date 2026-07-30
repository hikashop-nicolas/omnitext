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
}

export class BaseTransfer {
  private expecting: Offer | null = null;

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
      const { reason } = JSON.parse(textDec.decode(body)) as { reason: string };
      this.opts.report(`The other side could not take this document: ${reason}`);
    }
  }

  private onOffer(offer: Offer, peerId: string): void {
    const mine = this.opts.local();

    // Already the same file, the common case when both people were sent it. Nothing to
    // fetch, but the session still has to be told, or a joiner would never bind.
    if (mine && mine.hash === offer.hash) {
      this.opts.alreadyHave?.();
      return;
    }

    if (mine?.dirty) {
      const reason = "it has unsaved changes to a different document";
      this.send(frameJson(KIND.decline, { reason }), peerId);
      this.opts.report(
        `This session is for "${offer.name}", but you have unsaved changes to a different` +
          ` document. Save or close it first; nothing has been replaced.`,
      );
      return;
    }

    if (offer.size > this.limit) {
      const reason = `it is ${Math.round(offer.size / 1024 / 1024)} MB, over the limit`;
      this.send(frameJson(KIND.decline, { reason }), peerId);
      this.opts.report(`"${offer.name}" is too large to share (limit ${Math.round(this.limit / 1024 / 1024)} MB).`);
      return;
    }

    if (offer.size > WARN_BYTES) {
      this.opts.report(`Fetching "${offer.name}" (${Math.round(offer.size / 1024 / 1024)} MB); this may take a while.`);
    }

    this.expecting = offer;
    this.send(frame(KIND.request, new Uint8Array(0)), peerId);
  }

  private async onRequest(peerId: string): Promise<void> {
    const doc = await this.opts.serve();
    if (!doc) return;
    this.send(frame(KIND.data, doc.bytes), peerId);
  }

  private async onData(bytes: Uint8Array): Promise<void> {
    const offer = this.expecting;
    if (!offer) {
      this.opts.report("Received a document nobody asked for; ignoring it.");
      return;
    }
    this.expecting = null;

    // Copy: the payload may be a view into a larger receive buffer.
    const copy = new Uint8Array(bytes);
    const hash = await hashBytes(copy);
    if (hash !== offer.hash) {
      this.opts.report(`"${offer.name}" arrived damaged and was discarded.`);
      return;
    }
    this.opts.accept({ name: offer.name, bytes: copy, hash });
  }
}
