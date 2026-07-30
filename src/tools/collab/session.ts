import type { CollabBinding } from "../../core/types";
import { BaseTransfer, type BaseDoc } from "./base";
import { newRoomKey, type RoomKey } from "./link";
import { CollabProvider, type Peer } from "./provider";
import { trysteroTransport, type CollabTransport } from "./transport";

// One live collaboration session: a room, a shared document, the base file, and the
// active editor's binding.
//
// Everything the session needs from the application arrives through SessionHost rather
// than through HostAPI, so the whole lifecycle is testable with no browser, no network
// and no editor.

export interface SessionHost {
  /** The document this session is built on, for the host to serve. Null if none is open. */
  currentDoc(): Promise<BaseDoc | null>;
  /** What this peer holds right now, so a joiner can refuse rather than lose work. */
  localState(): { hash: string; dirty: boolean } | null;
  /** A verified base arrived: open it, then re-bind the editor to the session. */
  openBase(doc: BaseDoc): Promise<void> | void;
  /** The active editor's binding, or null when this editor cannot collaborate. */
  binding(): CollabBinding | null;
  /** Anything the person needs told. */
  notify(message: string): void;
  /** Called whenever the peer list or connection state changes, for the UI. */
  onChange?(): void;
}

export interface SessionOptions {
  /** Omit to start a new room; pass the key from a link to join one. */
  key?: RoomKey;
  /** Self-chosen, no identity attached. */
  name: string;
  colour: string;
  /** A view-only session: mirror edits in, publish none out. */
  readOnly?: boolean;
  /** Test seam. */
  makeTransport?(key: RoomKey): CollabTransport;
}

export class CollabSession {
  readonly key: RoomKey;
  /** True for the peer that started the room: the only one that seeds the shared doc. */
  readonly isHost: boolean;
  readonly readOnly: boolean;
  readonly provider: CollabProvider;
  private readonly transport: CollabTransport;
  private readonly base: BaseTransfer;
  private readonly host: SessionHost;
  private binding: CollabBinding | null = null;
  private bound = false;
  private closed = false;
  private unsupported = false;

  constructor(host: SessionHost, opts: SessionOptions) {
    this.host = host;
    this.isHost = !opts.key;
    this.key = opts.key ?? newRoomKey();
    this.readOnly = opts.readOnly ?? false;

    this.transport = (opts.makeTransport ?? ((k) => trysteroTransport({ roomId: k.roomId, secret: k.secret })))(
      this.key,
    );
    this.provider = new CollabProvider(this.transport);
    this.provider.setPresence({ name: opts.name, colour: opts.colour });

    this.base = new BaseTransfer(
      (payload, peerId) => this.transport.send("base", payload, peerId),
      {
        local: () => this.host.localState(),
        serve: () => this.host.currentDoc(),
        accept: (doc) => void this.onBaseArrived(doc),
        // Same file on both sides: nothing to fetch, but we still have to bind.
        alreadyHave: () => void this.attachWhenSynced(),
        report: (m) => this.host.notify(m),
      },
    );

    this.transport.onMessage((channel, payload, peerId) => {
      if (channel === "base") void this.base.receive(payload, peerId);
    });
    // Only the peer that started the room serves the base; joiners never offer theirs.
    if (this.isHost) this.transport.onPeerJoin((peerId) => void this.base.offerTo(peerId));
    this.provider.onPeersChanged(() => this.host.onChange?.());
  }

  /**
   * Attach the active editor. The host does this at once, since its own document is the
   * base. A joiner waits: binding before the base arrives would seed the session with
   * whatever it happened to have open.
   */
  async start(): Promise<void> {
    if (this.isHost) await this.attach();
  }

  private async attach(): Promise<void> {
    if (this.bound || this.closed) return;
    const binding = this.host.binding();
    if (!binding) {
      this.unsupported = true;
      this.host.notify("This editor cannot collaborate yet, so the session is view-only for you.");
      this.host.onChange?.();
      return;
    }
    this.unsupported = false;
    this.binding = binding;
    this.bound = true;
    await binding.bind({
      doc: this.provider.doc,
      awareness: this.provider.awareness,
      seed: this.isHost,
      readOnly: this.readOnly,
    });
    this.host.onChange?.();
  }

  private async onBaseArrived(doc: BaseDoc): Promise<void> {
    await this.host.openBase(doc);
    // The editor was replaced along with the document, so ask for its binding again.
    this.binding = null;
    this.bound = false;
    await this.attachWhenSynced();
  }

  /**
   * Bind only once the session's contents have actually arrived. Binding earlier would
   * have the joiner adopt an empty shared document and blank what it had open.
   */
  private async attachWhenSynced(): Promise<void> {
    if (this.bound || this.closed) return;
    await this.provider.whenSynced();
    if (this.closed) return;
    await this.attach();
  }

  peers(): Peer[] {
    return this.provider.peers();
  }

  get connected(): boolean {
    return this.transport.peers().length > 0;
  }

  /** True once this peer is mirroring the shared document. */
  get editing(): boolean {
    return this.bound;
  }

  /**
   * Why this peer is not editing together, so the UI can say which it is rather than
   * guessing. Two very different situations look identical from outside.
   */
  get status(): "editing" | "unsupported" | "waiting" {
    if (this.bound) return "editing";
    return this.unsupported ? "unsupported" : "waiting";
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.binding?.unbind();
    this.binding = null;
    await this.provider.destroy();
  }
}
