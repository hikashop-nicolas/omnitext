import type * as Y from "yjs";
import type { CollabBinding, CollabContext } from "../core/types";
import { debug } from "../core/debug";
import { publishPosition, watchPeers } from "./peer-presence";
import {
  dataUrlsIn,
  extrasType,
  fromBlobRefs,
  isEmpty,
  readAsChanges,
  seedBlocks,
  sharedTypes,
  readExtras,
  toBlobRefs,
  writeBlocks,
  writeExtras,
  type BlockChanges,
  type BlockState,
} from "./richdoc-collab";

// The collaboration binding for a richdoc editor, shared by docx, odt and doc.
//
// All three are the same editor behind a different adapter, so the binding belongs here
// rather than three times over. It talks to the handle below and to nothing else, which is
// also what makes it testable without a browser.

/** What this binding needs of a richdoc editor. A subset of RichEditor. */
export interface RichHandle {
  docExtras(): { kind: string; id: string; value: string }[];
  setDocExtrasReporter(handler: ((extras: { kind: string; id: string; value: string }[]) => void) | null): void;
  applyRemoteDocExtras(extras: { kind: string; id: string; value: string }[]): void;
  blockSnapshot(): BlockState[];
  applyRemoteBlocks(changes: BlockChanges): void;
  setBlockReporter(handler: ((changes: BlockChanges) => void) | null): void;
  setSelectionReporter(handler: ((at: BlockPosition | null) => void) | null): void;
  setPeerCarets(carets: readonly PeerCaretState[]): void;
  setAuthor(name: string): void;
  setUndoHandler(handler: { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean } | null): void;
}

/** Where a caret is, as richdoc describes it. */
export interface BlockPosition {
  blockId: string;
  offset: number;
}

/** Another person's cursor, as richdoc draws it. */
export interface PeerCaretState extends BlockPosition {
  id: string;
  name: string;
  colour: string;
}

/** How the binding reaches the editor, which may not exist yet when a session starts. */
export interface RichBindingHost {
  handle(): RichHandle | null;
  /**
   * Resolves once the editor has been built.
   *
   * A richdoc editor is constructed asynchronously: the file is inflated off the main
   * thread first, so the editor does not exist for some time after mount returns. A joiner
   * binds the moment the base file arrives, which is exactly when that inflation is still
   * running, so without waiting here `bind` finds no editor and gives up silently. The
   * session then looks connected and shares nothing, in both directions.
   */
  ready(): Promise<void>;
}

export function richdocBinding(host: RichBindingHost): CollabBinding {
  /** Marks our own transactions, so we neither echo them nor undo anyone else's. */
  const origin = { richdoc: {} };
  let shared: Y.Doc | null = null;
  let viewOnly = false;
  let applyingRemote = false;
  let unwatch: (() => void) | null = null;
  let unwatchPeers: (() => void) | null = null;
  /** Stops watching our own name, which moves when a clash renumbers it or we rename. */
  let unwatchMe: (() => void) | null = null;
  let undoManager: Y.UndoManager | null = null;
  let blobs: CollabContext["blobs"] | undefined;
  /** data: URL to its hash, so the same picture is not hashed on every keystroke. */
  const shaByUrl = new Map<string, string>();
  /** Payloads we have asked for and not yet received. */
  const awaiting = new Set<string>();

  /**
   * Lift image payloads out of the markup and into the blob store.
   *
   * The whole data: URL is what gets stored, not the decoded bytes. Restoring it is then
   * exact rather than reassembled from a mime type and base64, which matters here: richdoc
   * claims an untouched part of a document comes back byte for byte, and an image put back
   * together slightly differently would quietly break that.
   */
  const liftImages = async (blocks: BlockState[]): Promise<BlockState[]> => {
    if (!blobs) return blocks;
    for (const block of blocks) {
      for (const url of dataUrlsIn(block.html)) {
        if (shaByUrl.has(url)) continue;
        shaByUrl.set(url, await blobs.put(new TextEncoder().encode(url)));
      }
    }
    return blocks.map((b) => ({ ...b, html: toBlobRefs(b.html, (url) => shaByUrl.get(url)) }));
  };

  /** Put the payloads back, and fetch any this peer has not got yet. */
  const dropImagesIn = (blocks: BlockState[], onArrived: () => void): BlockState[] =>
    blocks.map((block) => {
      const { html, missing } = fromBlobRefs(block.html, (sha) => {
        const held = blobs?.get(sha);
        if (!held) return undefined;
        const url = new TextDecoder().decode(held);
        shaByUrl.set(url, sha); // so republishing it does not hash it again
        return url;
      });
      for (const sha of missing) {
        if (!blobs || awaiting.has(sha)) continue;
        awaiting.add(sha);
        void blobs.fetch(sha).then((got) => {
          awaiting.delete(sha);
          if (got) onArrived();
        });
      }
      return { ...block, html };
    });

  const publish = (changes: BlockChanges): void => {
    if (!shared || applyingRemote) return;
    // A view-only peer keeps its own typing to itself. richdoc has no read-only mode, so
    // this is the only thing standing between a watcher and everyone else's document.
    if (viewOnly) return;
    debug("wire", "publishing blocks", () => ({
      changed: changes.changed.length,
      removed: changes.removed.length,
    }));
    const doc = shared;
    void liftImages(changes.changed).then((lifted) => {
      // Re-checked after the await: a session can end while a payload is being hashed.
      if (shared !== doc || applyingRemote) return;
      writeBlocks(doc, { ...changes, changed: lifted }, origin);
    });
  };

  /** Put the shared body on screen without treating it as a local edit. */
  const applyRemote = (doc: Y.Doc): void => {
    const handle = host.handle();
    if (!handle) return;
    const incoming = readAsChanges(doc);
    applyingRemote = true;
    try {
      handle.applyRemoteBlocks({
        ...incoming,
        changed: dropImagesIn(incoming.changed, () => {
          if (shared === doc) applyRemote(doc); // the payload landed; draw it now
        }),
      });
    } finally {
      applyingRemote = false;
    }
  };

  return {
    bind: async (ctx: CollabContext) => {
      await host.ready(); // it is normal for the editor not to exist yet; see RichBindingHost
      const handle = host.handle();
      if (!handle) return; // construction failed, and the failure was already reported
      const doc = ctx.doc as unknown as Y.Doc;
      shared = doc;
      blobs = ctx.blobs;
      viewOnly = ctx.readOnly;

      // Subscribe before seeding, so nothing this peer does from here on is missed.
      // Suggestions and comments are signed. Without this both peers write under the name
      // the settings gave them, which for anyone who set none is the same name, and a
      // suggestion typed beside another by the "same" author is absorbed into it.
      if (ctx.me) {
        handle.setAuthor(ctx.me.name);
        const sub = ctx.me.onChanged((me) => host.handle()?.setAuthor(me.name));
        unwatchMe = () => sub.dispose();
      }

      handle.setBlockReporter(publish);
      // The document beside its body: headers, footers, notes, page geometry, styles.
      handle.setDocExtrasReporter((extras) => {
        if (!shared || applyingRemote || viewOnly) return;
        writeExtras(doc, extras, origin);
      });

      if (ctx.seed) {
        seedBlocks(doc, await liftImages(handle.blockSnapshot()), origin);
        writeExtras(doc, handle.docExtras(), origin);
      } else if (!isEmpty(doc)) {
        // Adopt the session's body. Only when there is one: adopting an empty shared
        // document would blank the file this peer already had open.
        applyRemote(doc);
      }

      const onChange = (_events: unknown, transaction: Y.Transaction): void => {
        if (transaction.origin === origin) return; // our own edit, already on screen
        applyRemote(doc);
      };
      const extras = extrasType(doc);
      const onExtras = (_e: unknown, transaction: Y.Transaction): void => {
        if (transaction.origin === origin) return;
        const incoming = readExtras(doc);
        if (!incoming.length) return;
        applyingRemote = true;
        try {
          handle.applyRemoteDocExtras(incoming);
        } finally {
          applyingRemote = false;
        }
      };
      extras.observe(onExtras);
      const [blocks, order] = sharedTypes(doc);
      blocks.observeDeep(onChange); // deep: typing inside a block changes its Y.Text, not the map
      order.observe(onChange);
      unwatch = () => {
        blocks.unobserveDeep(onChange);
        order.unobserve(onChange);
        extras.unobserve(onExtras);
      };

      // Presence: publish where this caret is, and draw everyone else's.
      handle.setSelectionReporter((at) => publishPosition(ctx.awareness, at));
      unwatchPeers = watchPeers<BlockPosition | null>(ctx.awareness, (peers) => {
        handle.setPeerCarets(
          peers
            .filter((p): p is typeof p & { at: BlockPosition } => !!p.at && typeof p.at.blockId === "string")
            .map((p) => ({ id: p.id, name: p.name, colour: p.colour, ...p.at })),
        );
      });

      // Undo has to be ours alone. richdoc's own undo restores a whole-body snapshot,
      // which would take back a peer's edits along with this peer's; scoping the manager
      // to our origin undoes only what we did.
      if (!ctx.readOnly) {
        const { UndoManager } = await import("yjs"); // only a session pays for this
        undoManager = new UndoManager(sharedTypes(doc), { trackedOrigins: new Set([origin]) });
        const manager = undoManager;
        handle.setUndoHandler({
          undo: () => manager.undo(),
          redo: () => manager.redo(),
          canUndo: () => manager.canUndo(),
          canRedo: () => manager.canRedo(),
        });
      }
    },

    unbind: () => {
      unwatch?.();
      unwatch = null;
      unwatchMe?.();
      unwatchMe = null;
      unwatchPeers?.();
      unwatchPeers = null;
      undoManager?.destroy();
      undoManager = null;
      awaiting.clear();
      blobs = undefined;
      const handle = host.handle();
      handle?.setBlockReporter(null); // stop paying for the diff once nobody wants it
      handle?.setDocExtrasReporter(null);
      handle?.setSelectionReporter(null);
      handle?.setPeerCarets([]); // nobody is here any more, so nobody is drawn
      handle?.setUndoHandler(null);
      shared = null;
      viewOnly = false;
    },
  };
}
