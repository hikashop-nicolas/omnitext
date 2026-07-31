import type * as Y from "yjs";
import type { CollabBinding, CollabContext } from "../core/types";
import { debug } from "../core/debug";
import {
  isEmpty,
  readShared,
  seedShared,
  sharedTypes,
  writeShared,
  type ImageRef,
  type SharedEdits,
} from "./pdf-collab";

// The collaboration binding for a PDF.
//
// Everything here is the same shape as the other bindings except one thing: an image has
// bytes, and the bytes are not in the CRDT. So this is where the two halves meet. Going
// out, an image's bytes are put in the blob store and the hash goes into the document.
// Coming in, an image is held back until its bytes have actually arrived, because half an
// image is worse than none: pdfedit would be handed an empty payload and draw nothing,
// with no way to tell that from an image that was deleted.

/** One image as pdfedit deals with them: bytes, not a hash. */
interface PdfImage {
  id: string;
  page: number;
  bytes: Uint8Array;
  mime: string;
  leftPx: number;
  topPx: number;
  widthPx: number;
}

/** What pdfedit reports and accepts. */
export interface PdfSnapshotLike {
  edits: SharedEdits["edits"];
  boxes: SharedEdits["boxes"];
  images: PdfImage[];
  whiteouts: SharedEdits["whiteouts"];
}

/** What this binding needs of a pdfedit editor. A subset of PdfEditor. */
export interface PdfHandle {
  getSnapshot(): PdfSnapshotLike;
  applyRemote(snap: PdfSnapshotLike): void;
  setChangeReporter(handler: ((snap: PdfSnapshotLike) => void) | null): void;
  setUndoHandler(
    handler: { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean } | null,
  ): void;
}

export interface PdfBindingHost {
  handle(): PdfHandle | null;
}

export function pdfBinding(host: PdfBindingHost): CollabBinding {
  /** Marks our own transactions, so we neither echo them nor undo anyone else's. */
  const origin = { pdf: {} };
  let shared: Y.Doc | null = null;
  let blobs: CollabContext["blobs"] | undefined;
  let viewOnly = false;
  let applyingRemote = false;
  let unwatch: (() => void) | null = null;
  let undoManager: Y.UndoManager | null = null;

  /**
   * Hashes we have already computed, by the exact byte array pdfedit holds.
   *
   * pdfedit keeps one Uint8Array per image for the life of that image, so identity is a
   * safe key, and hashing is the one expensive thing on this path: without it every
   * keystroke would re-hash every image in the document.
   */
  const shaByBytes = new WeakMap<Uint8Array, string>();

  /** Images whose bytes we are still waiting for, so a late arrival can be drawn. */
  const awaiting = new Set<string>();

  const publish = async (snap: PdfSnapshotLike): Promise<void> => {
    if (!shared || applyingRemote || viewOnly) return;
    const doc = shared;

    const refs: ImageRef[] = [];
    for (const image of snap.images) {
      let sha = shaByBytes.get(image.bytes);
      if (!sha && blobs) {
        sha = await blobs.put(image.bytes);
        shaByBytes.set(image.bytes, sha);
      }
      if (!sha) continue; // no blob store: an image cannot be named, so it cannot be shared
      refs.push({
        id: image.id,
        page: image.page,
        mime: image.mime,
        sha,
        leftPx: image.leftPx,
        topPx: image.topPx,
        widthPx: image.widthPx,
      });
    }

    // Re-checked after the await: a session can end while bytes are being hashed.
    if (shared !== doc || applyingRemote) return;
    debug("wire", "publishing pdf edits", () => ({
      edits: snap.edits.length,
      objects: snap.boxes.length + refs.length + snap.whiteouts.length,
    }));
    writeShared(doc, { edits: snap.edits, boxes: snap.boxes, images: refs, whiteouts: snap.whiteouts }, origin);
  };

  /**
   * Put the shared edits on screen, with whatever images we actually hold.
   *
   * An image whose bytes have not arrived is left out of this pass and fetched; when it
   * lands, the whole state is applied again and the image appears. Leaving it out is the
   * point: passing pdfedit an empty payload would draw an invisible image that looks
   * exactly like one that was deleted.
   */
  const applyRemote = (doc: Y.Doc): void => {
    const handle = host.handle();
    if (!handle) return;
    const state = readShared(doc);

    const images: PdfImage[] = [];
    for (const ref of state.images) {
      const bytes = blobs?.get(ref.sha);
      if (bytes) {
        shaByBytes.set(bytes, ref.sha); // so republishing it does not hash it again
        images.push({ ...ref, bytes });
      } else if (blobs && !awaiting.has(ref.sha)) {
        awaiting.add(ref.sha);
        void blobs.fetch(ref.sha).then((got) => {
          awaiting.delete(ref.sha);
          if (got && shared === doc) applyRemote(doc); // now we can draw it
        });
      }
    }

    applyingRemote = true;
    try {
      handle.applyRemote({ edits: state.edits, boxes: state.boxes, images, whiteouts: state.whiteouts });
    } finally {
      applyingRemote = false;
    }
  };

  return {
    bind: async (ctx: CollabContext) => {
      const handle = host.handle();
      if (!handle) return;
      const doc = ctx.doc as unknown as Y.Doc;
      shared = doc;
      blobs = ctx.blobs;
      viewOnly = ctx.readOnly;

      handle.setChangeReporter((snap) => void publish(snap));

      if (ctx.seed) {
        // The base file is the same on both sides, so what is seeded is the edits this
        // peer has already made on top of it, which is usually nothing.
        const snap = handle.getSnapshot();
        const refs: ImageRef[] = [];
        for (const image of snap.images) {
          if (!ctx.blobs) break;
          const sha = await ctx.blobs.put(image.bytes);
          shaByBytes.set(image.bytes, sha);
          refs.push({ ...image, sha, bytes: undefined } as unknown as ImageRef);
        }
        seedShared(doc, { edits: snap.edits, boxes: snap.boxes, images: refs, whiteouts: snap.whiteouts }, origin);
      } else if (!isEmpty(doc)) {
        applyRemote(doc);
      }

      const onChange = (_events: unknown, transaction: Y.Transaction): void => {
        if (transaction.origin === origin) return; // our own edit, already on screen
        applyRemote(doc);
      };
      const [paras, objects] = sharedTypes(doc);
      // Deep: typing inside a paragraph changes its Y.Text, not the map that holds it.
      paras.observeDeep(onChange);
      objects.observeDeep(onChange);
      unwatch = () => {
        paras.unobserveDeep(onChange);
        objects.unobserveDeep(onChange);
      };

      // Undo has to be ours alone. pdfedit's own undo restores a whole-document snapshot,
      // which would take back a peer's edits along with this peer's.
      if (!ctx.readOnly) {
        const { UndoManager } = await import("yjs");
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
      undoManager?.destroy();
      undoManager = null;
      awaiting.clear();
      const handle = host.handle();
      handle?.setChangeReporter(null);
      handle?.setUndoHandler(null);
      shared = null;
      blobs = undefined;
      viewOnly = false;
    },
  };
}
