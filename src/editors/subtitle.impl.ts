import { createSubtitleEditor, type Cue, type SubtitleEditorHandle } from "subedit";
import type * as Y from "yjs";
import type {
  CollabBinding,
  CollabContext,
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";
import { isEmpty, readCues, seedCues, sharedTypes, writeCues } from "./subtitle-collab";
import { publishPosition, watchPeers } from "./peer-presence";

// subedit reads the format from the filename extension. A new blank document has no
// filename, so map the format's MIME (always set by the host) to a synthetic name, else
// a blank .ass would open as SRT. Real opened files keep their own filename.
const MIME_EXT: Record<string, string> = {
  "application/x-subrip": "srt",
  "text/srt": "srt",
  "text/vtt": "vtt",
  "text/x-ass": "ass",
  "text/x-ssa": "ssa",
};

function subtitleFilename(ctx: EditorMountContext): string | undefined {
  if (ctx.filename) return ctx.filename;
  const ext = ctx.mime ? MIME_EXT[ctx.mime] : undefined;
  return ext ? `untitled.${ext}` : undefined;
}

// Thin adapter wrapping the standalone subedit library (subtitle editor for SRT / VTT /
// ASS / SSA, with cue list, timing pane and video/waveform preview, byte-preserving
// round-trips) as an Omnitext editor module. subedit renders its own toolbar and panes;
// this adapter just routes edits back through the Omnitext host. Saving is handled by
// Omnitext (getText -> format.serialize), so subedit's own save button stays hidden.
class SubtitleInstance implements EditorInstance {
  private handle: SubtitleEditorHandle | null = null;
  /** Set while a session is running; every local edit is mirrored into it. */
  private shared: Y.Doc | null = null;
  /** Marks our own transactions, so we neither echo them nor undo anyone else's. */
  private readonly origin = { subtitle: this };
  private undoManager: Y.UndoManager | null = null;
  private unwatch: (() => void) | null = null;
  private unwatchPeers: (() => void) | null = null;
  private applyingRemote = false;
  /** Set while a session runs, so a selection change can be published. */
  private publishSelection: ((cueId: string | null) => void) | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.handle = createSubtitleEditor(
      container,
      { text: ctx.text, filename: subtitleFilename(ctx) },
      {
        onChange: () => {
          this.publish();
          ctx.onChange();
        },
        onSelectionChanged: (cueId) => this.publishSelection?.(cueId),
        showSave: false,
      },
    );
  }

  /** Mirror the local cue list into the shared document, if a session is running. */
  private publish(): void {
    if (!this.shared || !this.handle || this.applyingRemote) return;
    writeCues(this.shared, this.handle.cueSnapshot(), this.origin);
  }

  getText(): string {
    return this.handle?.getText() ?? "";
  }

  selection(): unknown {
    return null;
  }

  collab(): CollabBinding {
    return {
      bind: async (ctx: CollabContext) => {
        const handle = this.handle;
        if (!handle) return;
        const doc = ctx.doc as unknown as Y.Doc;
        this.shared = doc;

        if (ctx.seed) {
          seedCues(doc, handle.cueSnapshot(), this.origin);
        } else if (!isEmpty(doc)) {
          // Adopt the session's cues. Only when there are some: adopting an empty shared
          // document would blank the file this peer already had open.
          this.applyRemote(doc);
        }

        const onChange = (_events: unknown, transaction: Y.Transaction): void => {
          if (transaction.origin === this.origin) return; // our own edit, already on screen
          this.applyRemote(doc);
        };
        const [cues, order] = sharedTypes(doc);
        cues.observe(onChange);
        order.observe(onChange);
        this.unwatch = () => {
          cues.unobserve(onChange);
          order.unobserve(onChange);
        };

        // Presence: publish which cue we are on, and mark the cues the others are on.
        this.publishSelection = (cueId) => publishPosition(ctx.awareness, { cueId });
        this.publishSelection(handle.selectedCueId()); // visible now, not once we next move
        this.unwatchPeers = watchPeers<{ cueId: string | null }>(ctx.awareness, (peers) => {
          handle.setPeerCues(
            peers.map((p) => ({ id: p.id, colour: p.colour, name: p.name, cueId: p.at?.cueId ?? null })),
          );
        });

        // Undo has to be ours alone. subedit's own undo restores a whole-model snapshot,
        // which would take back a peer's edits along with this peer's; scoping the manager
        // to our origin undoes only what we did.
        if (!ctx.readOnly) {
          const { UndoManager } = await import("yjs"); // only a session pays for this
          this.undoManager = new UndoManager(sharedTypes(doc), {
            trackedOrigins: new Set([this.origin]),
          });
          const manager = this.undoManager;
          handle.setUndoHandler({
            undo: () => manager.undo(),
            redo: () => manager.redo(),
            canUndo: () => manager.canUndo(),
            canRedo: () => manager.canRedo(),
          });
        }
      },

      unbind: () => {
        this.unwatch?.();
        this.unwatch = null;
        this.unwatchPeers?.();
        this.unwatchPeers = null;
        this.publishSelection = null;
        this.handle?.setPeerCues([]);
        this.undoManager?.destroy();
        this.undoManager = null;
        this.handle?.setUndoHandler(null);
        this.shared = null;
      },
    };
  }

  /** Put the shared cue list on screen without treating it as a local edit. */
  private applyRemote(doc: Y.Doc): void {
    if (!this.handle) return;
    this.applyingRemote = true;
    try {
      this.handle.applyRemoteCues(readCues<Cue>(doc));
    } finally {
      this.applyingRemote = false;
    }
  }

  focus(): void {
    this.handle?.focus();
  }

  dispose(): void {
    this.unwatch?.();
    this.unwatchPeers?.();
    this.undoManager?.destroy();
    this.handle?.destroy();
    this.handle = null;
    this.shared = null;
  }
}

export const subtitleEditor: EditorModule = {
  create: () => new SubtitleInstance(),
};
