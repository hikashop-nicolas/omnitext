import type * as Y from "yjs";
import type { CollabBinding, CollabContext } from "../core/types";
import { debug } from "../core/debug";
import { publishPosition, watchPeers } from "./peer-presence";
import {
  isEmpty,
  readAsChanges,
  seedBlocks,
  sharedTypes,
  writeBlocks,
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
  blockSnapshot(): BlockState[];
  applyRemoteBlocks(changes: BlockChanges): void;
  setBlockReporter(handler: ((changes: BlockChanges) => void) | null): void;
  setUndoHandler(handler: { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean } | null): void;
}

/** How the binding reaches the editor, which may not exist yet when a session starts. */
export interface RichBindingHost {
  handle(): RichHandle | null;
}

export function richdocBinding(host: RichBindingHost): CollabBinding {
  /** Marks our own transactions, so we neither echo them nor undo anyone else's. */
  const origin = { richdoc: {} };
  let shared: Y.Doc | null = null;
  let viewOnly = false;
  let applyingRemote = false;
  let unwatch: (() => void) | null = null;
  let unwatchPeers: (() => void) | null = null;
  let undoManager: Y.UndoManager | null = null;

  const publish = (changes: BlockChanges): void => {
    if (!shared || applyingRemote) return;
    // A view-only peer keeps its own typing to itself. richdoc has no read-only mode, so
    // this is the only thing standing between a watcher and everyone else's document.
    if (viewOnly) return;
    debug("wire", "publishing blocks", () => ({
      changed: changes.changed.length,
      removed: changes.removed.length,
    }));
    writeBlocks(shared, changes, origin);
  };

  /** Put the shared body on screen without treating it as a local edit. */
  const applyRemote = (doc: Y.Doc): void => {
    const handle = host.handle();
    if (!handle) return;
    applyingRemote = true;
    try {
      handle.applyRemoteBlocks(readAsChanges(doc));
    } finally {
      applyingRemote = false;
    }
  };

  return {
    bind: async (ctx: CollabContext) => {
      const handle = host.handle();
      if (!handle) return; // still inflating; the session binds again when it is ready
      const doc = ctx.doc as unknown as Y.Doc;
      shared = doc;
      viewOnly = ctx.readOnly;

      // Subscribe before seeding, so nothing this peer does from here on is missed.
      handle.setBlockReporter(publish);

      if (ctx.seed) {
        seedBlocks(doc, handle.blockSnapshot(), origin);
      } else if (!isEmpty(doc)) {
        // Adopt the session's body. Only when there is one: adopting an empty shared
        // document would blank the file this peer already had open.
        applyRemote(doc);
      }

      const onChange = (_events: unknown, transaction: Y.Transaction): void => {
        if (transaction.origin === origin) return; // our own edit, already on screen
        applyRemote(doc);
      };
      const [blocks, order] = sharedTypes(doc);
      blocks.observeDeep(onChange); // deep: typing inside a block changes its Y.Text, not the map
      order.observe(onChange);
      unwatch = () => {
        blocks.unobserveDeep(onChange);
        order.unobserve(onChange);
      };

      // Presence: publish nothing about position yet. A caret in a rich document is an
      // offset into a block, and drawing someone else's needs the editor to expose one;
      // until it does, an empty position is honest and a guessed one would not be.
      unwatchPeers = watchPeers(ctx.awareness, () => undefined);
      publishPosition(ctx.awareness, null);

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
      unwatchPeers?.();
      unwatchPeers = null;
      undoManager?.destroy();
      undoManager = null;
      host.handle()?.setBlockReporter(null); // stop paying for the diff once nobody wants it
      host.handle()?.setUndoHandler(null);
      shared = null;
      viewOnly = false;
    },
  };
}
