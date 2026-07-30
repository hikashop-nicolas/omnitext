import { createSheetEditorAsync, type CellInput as SheetCellInput, type SheetEditor } from "sheetedit";
import type * as Y from "yjs";
import type {
  CollabBinding,
  CollabContext,
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";
import { changedCells, isEmpty, readCells, seedCells, sharedType, writeCells } from "./sheet-collab";
import { publishPosition, watchPeers } from "./peer-presence";

// Thin adapter wrapping the standalone sheetedit library (.xlsx/.ods/.csv grid editor
// with formula recalculation and in-place preservation) as an Omnitext editor module.
// Binary workbooks flow through bytes; csv/tsv documents flow through the app's text
// pipeline (encoding menu, history, .gz) via sheetedit's synchronous getText().
class SheetInstance implements EditorInstance {
  private editor: SheetEditor | null = null;
  private bytes: Uint8Array = new Uint8Array();
  private text = "";
  private binary = true;
  private disposed = false;
  /** Set while a session is running; every local cell edit is mirrored into it. */
  private shared: Y.Doc | null = null;
  /** Marks our own transactions, so we neither echo them nor undo anyone else's. */
  private readonly origin = { sheet: this };
  private undoManager: Y.UndoManager | null = null;
  private unwatch: (() => void) | null = null;
  private unwatchPeers: (() => void) | null = null;
  /** Set while a session runs, so a selection change can be published. */
  private publishSelection: ((at: { sheet: string; r: number; c: number }) => void) | null = null;

  mount(container: HTMLElement, ctx: EditorMountContext): void {
    this.binary = ctx.binary;
    this.text = ctx.text;
    this.bytes = ctx.bytes ?? new TextEncoder().encode(ctx.text);
    const isTsv = (ctx.mime ?? "").includes("tab-separated") || /\.tsv$/i.test(ctx.filename ?? "");
    // Async factory inflates a zip-based workbook off the main thread before the parse.
    void createSheetEditorAsync(container, this.bytes, {
      onChange: ctx.onChange,
      onCellsChanged: (changes) => this.publish(changes),
      onSelectionChanged: (at) => this.publishSelection?.(at),
      formatHint: ctx.binary ? undefined : isTsv ? "tsv" : "csv",
      fileName: ctx.filename,
      onConvert: (bytes, name) => {
        window.dispatchEvent(
          new CustomEvent("omnitext:open-bytes", {
            detail: { name, bytes, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          }),
        );
      },
    })
      .then((editor) => {
        if (this.disposed) editor.destroy(); // disposed while inflating: don't leak the editor
        else this.editor = editor;
      })
      .catch((e: unknown) => {
        console.error("[omnitext] sheet editor construction failed", e);
      });
  }

  /** Mirror local cell edits into the shared workbook, if a session is running. */
  private publish(changes: SheetCellInput[]): void {
    if (this.shared) writeCells(this.shared, changes, this.origin);
  }

  collab(): CollabBinding {
    return {
      bind: async (ctx: CollabContext) => {
        const editor = this.editor;
        if (!editor) return; // still inflating; a session on a workbook this large is rare
        const doc = ctx.doc as unknown as Y.Doc;
        this.shared = doc;

        if (ctx.seed) {
          seedCells(doc, editor.cellInputs(), this.origin);
        } else if (!isEmpty(doc)) {
          // Adopt the session's cells. Only when there are some: adopting an empty shared
          // workbook would say nothing and leave the two sides disagreeing.
          editor.applyRemoteCells(readCells(doc));
        }

        const map = sharedType(doc);
        const onChange = (event: Y.YMapEvent<string>, transaction: Y.Transaction): void => {
          if (transaction.origin === this.origin) return; // our own edit, already on screen
          editor.applyRemoteCells(changedCells(doc, event.keysChanged));
        };
        map.observe(onChange);
        this.unwatch = () => map.unobserve(onChange);

        // Presence: publish which cell we are on, and outline the ones the others are on.
        this.publishSelection = (at) => publishPosition(ctx.awareness, at);
        this.unwatchPeers = watchPeers<{ sheet: string; r: number; c: number }>(ctx.awareness, (peers) => {
          editor.setPeerCells(
            peers
              .filter((p) => p.at && typeof p.at.sheet === "string")
              .map((p) => ({ id: p.id, colour: p.colour, name: p.name, ...p.at })),
          );
        });

        // Undo has to be ours alone, or Ctrl+Z takes back a peer's typing.
        if (!ctx.readOnly) {
          const { UndoManager } = await import("yjs");
          this.undoManager = new UndoManager(map, { trackedOrigins: new Set([this.origin]) });
        }
      },

      unbind: () => {
        this.unwatch?.();
        this.unwatch = null;
        this.unwatchPeers?.();
        this.unwatchPeers = null;
        this.publishSelection = null;
        this.editor?.setPeerCells([]);
        this.undoManager?.destroy();
        this.undoManager = null;
        this.shared = null;
      },
    };
  }

  getText(): string {
    if (this.binary) return "";
    return this.editor?.getText() ?? this.text;
  }

  getBytes(): Promise<Uint8Array> {
    return this.editor ? this.editor.getBytes() : Promise.resolve(this.bytes);
  }

  selection(): unknown {
    return null;
  }

  focus(): void {}

  dispose(): void {
    this.disposed = true;
    this.unwatch?.();
    this.unwatchPeers?.();
    this.undoManager?.destroy();
    this.shared = null;
    this.editor?.destroy();
    this.editor = null;
  }
}

export const sheetEditor: EditorModule = {
  create: () => new SheetInstance(),
};
