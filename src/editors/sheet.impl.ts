import { createSheetEditorAsync, type CellInput as SheetCellInput, type SheetEditor, type SheetImageInfo } from "sheetedit";
import type * as Y from "yjs";
import type {
  CollabBinding,
  CollabContext,
  EditorInstance,
  EditorModule,
  EditorMountContext,
} from "../core/types";
import {
  changedCells,
  isEmpty,
  readCells,
  readCharts,
  readImages,
  readDrawings,
  readPivots,
  readFormats,
  readNames,
  readSettings,
  readQueries,
  readSheets,
  seedCells,
  sharedType,
  sheetSharedTypes,
  writeCells,
  writeCharts,
  writeImages,
  writeDrawings,
  writePivots,
  writeFormats,
  writeNames,
  writeSettings,
  writeQueries,
  writeSheets,
  type ImageRef,
} from "./sheet-collab";
import { publishPosition, watchPeers } from "./peer-presence";
import { OpSequencer, shiftCells, type StructuralOp } from "./sheet-structure";
import { debug } from "../core/debug";

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
  /** A view-only session: mirror edits in, publish none out. */
  private viewOnly = false;
  private unwatch: (() => void) | null = null;
  private unwatchPeers: (() => void) | null = null;
  /** Set while a session runs, so a selection change can be published. */
  private publishSelection: ((at: { sheet: string; r: number; c: number }) => void) | null = null;
  /** Set while a session runs: hands a structural edit to the session to be ordered. */
  private propose: ((op: StructuralOp) => void) | null = null;
  private unwatchOrdered: (() => void) | null = null;
  private unwatchSheets: (() => void) | null = null;
  private blobs: CollabContext["blobs"] | undefined;
  /** A picture's data URI to its hash, so an unchanged one is not re-hashed on every edit. */
  private readonly shaByUri = new Map<string, string>();
  private readonly awaiting = new Set<string>();

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
      // Cells are shared by address, so inserting a row moves every address below it.
      // That cannot be merged, so it is ordered instead: the edit is proposed, one peer
      // puts it in sequence, and everyone applies it there. Always refused locally, since
      // it comes back through that path a moment later and applying it twice would move
      // the addresses twice.
      allowStructuralEdit: (op) => {
        if (!this.shared) return true; // no session: their own workbook, their call
        // Watching: refuse outright rather than fall through to allowing it. Letting a
        // view-only peer insert a row locally would leave their grid a row out of step with
        // everyone else's, and every address below it pointing at the wrong cell.
        if (this.viewOnly) return false;
        if (!this.propose) return true;
        this.propose({ kind: op.kind, axis: op.axis, sheet: op.sheet, at: op.at, count: op.count });
        return false;
      },
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

  /**
   * Put pictures into the shared workbook, with their payloads in the blob store.
   *
   * A picture in the CRDT would stay there for the life of the session, so replacing one
   * twice would cost three pictures for ever. What crosses is a hash.
   */
  private async publishImages(doc: Y.Doc, images: readonly SheetImageInfo[]): Promise<void> {
    if (!this.blobs) return;
    const refs: ImageRef[] = [];
    for (const im of images) {
      let sha = this.shaByUri.get(im.dataUri);
      if (!sha) {
        sha = await this.blobs.put(new TextEncoder().encode(im.dataUri));
        this.shaByUri.set(im.dataUri, sha);
      }
      refs.push({ id: im.id, sheet: im.sheet, anchor: im.anchor, sha });
    }
    // Re-checked after the awaits: a session can end while payloads are being hashed.
    if (this.shared !== doc) return;
    writeImages(doc, refs, this.origin);
  }

  /**
   * Put the session's sheets and pictures on screen.
   *
   * A picture whose payload has not arrived is left out of this pass and fetched; when it
   * lands the whole state is applied again. Passing an empty payload would draw a blank
   * where a picture is, which looks exactly like one somebody cleared.
   */
  private applySheetsAndImages(doc: Y.Doc): void {
    const editor = this.editor;
    if (!editor) return;
    const sheets = readSheets(doc);
    if (sheets.length) editor.applyRemoteSheets(sheets);
    const charts = readCharts(doc);
    if (charts.length) editor.applyRemoteCharts(charts);
    // Definitions only. The rows a refresh produces arrive as cells, from whoever ran it.
    const names = readNames(doc);
    if (Object.keys(names).length) editor.applyRemoteDefinedNames(names);
    // Formatting is applied as cell changes whose input is left alone: applyRemoteCells
    // writes the value first, so an empty one here would blank the cell it is styling.
    const formats = readFormats(doc).map((f) => ({
      ...f,
      input: editor.cellInputs().find((c) => c.sheet === f.sheet && c.r === f.r && c.c === f.c)?.input ?? "",
    }));
    if (formats.length) editor.applyRemoteCells(formats);
    const settings = readSettings(doc);
    if (settings.length) editor.applyRemoteSheetSettings(settings);
    const drawings = readDrawings(doc);
    if (drawings.length) editor.applyRemoteDrawings(drawings);
    const pivots = readPivots(doc);
    if (pivots.length) editor.applyRemotePivots(pivots);
    const sectionM = readQueries(doc);
    if (sectionM != null) void editor.applyRemoteQueries(sectionM);

    const ready: SheetImageInfo[] = [];
    for (const ref of readImages(doc)) {
      const held = this.blobs?.get(ref.sha);
      if (held) {
        const uri = new TextDecoder().decode(held);
        this.shaByUri.set(uri, ref.sha);
        ready.push({ id: ref.id, sheet: ref.sheet, anchor: ref.anchor, dataUri: uri });
      } else if (this.blobs && !this.awaiting.has(ref.sha)) {
        this.awaiting.add(ref.sha);
        void this.blobs.fetch(ref.sha).then((got) => {
          this.awaiting.delete(ref.sha);
          if (got && this.shared === doc) this.applySheetsAndImages(doc);
        });
      }
    }
    if (ready.length) editor.applyRemoteImages(ready);
  }

  /** Mirror local cell edits into the shared workbook, if a session is running. */
  private publish(changes: SheetCellInput[]): void {
    if (!this.shared) return;
    // A view-only peer keeps its own typing to itself. sheetedit has no read-only mode, so
    // this is the only thing standing between a watcher and everyone else's workbook.
    if (this.viewOnly) return;
    debug("wire", "publishing cells", () => changes);
    writeCells(this.shared, changes, this.origin);
    // Formatting travels in its own map, so typing in a cell does not re-send how it looks.
    writeFormats(this.shared, changes, this.origin);
  }

  collab(): CollabBinding {
    return {
      bind: async (ctx: CollabContext) => {
        const editor = this.editor;
        if (!editor) return; // still inflating; a session on a workbook this large is rare
        const doc = ctx.doc as unknown as Y.Doc;
        this.shared = doc;
        this.blobs = ctx.blobs;
        this.viewOnly = ctx.readOnly;

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
          const cells = changedCells(doc, event.keysChanged);
          debug("wire", "applying cells from a peer", () => cells);
          editor.applyRemoteCells(cells);
        };
        map.observe(onChange);
        this.unwatch = () => map.unobserve(onChange);

        // Presence: publish which cell we are on, and outline the ones the others are on.
        this.publishSelection = (at) => publishPosition(ctx.awareness, at);
        const at = editor.selectedCell();
        if (at) this.publishSelection(at); // visible now, not once we next move
        this.unwatchPeers = watchPeers<{ sheet: string; r: number; c: number }>(ctx.awareness, (peers) => {
          editor.setPeerCells(
            peers
              .filter((p) => p.at && typeof p.at.sheet === "string")
              .map((p) => ({ id: p.id, colour: p.colour, name: p.name, ...p.at })),
          );
        });

        // Structural edits: proposed here, ordered by one peer, applied by everyone in that
        // order. The host also rewrites the shared cell map, once, in the same step: if
        // every peer shifted it themselves the same move would be written many times over.
        if (ctx.ordered) {
          // A view-only peer applies the order but never adds to it: proposing a row insert
          // would restructure everyone's workbook, which is the opposite of watching.
          if (!ctx.readOnly) {
            this.propose = (op) => {
              debug("collab", "proposing a structural edit", () => op);
              ctx.ordered!.propose(op);
            };
          }
          const sequencer = new OpSequencer((op) => {
            debug("collab", `applying structural operation ${op.seq}`, () => op);
            if (ctx.seed) writeCells(doc, shiftCells(readCells(doc), op), this.origin);
            editor.applyRemoteStructural(op);
          });
          const sub = ctx.ordered.onOrdered((op, seq) =>
            sequencer.receive({ ...(op as StructuralOp), seq }),
          );
          this.unwatchOrdered = () => sub.dispose();
        }

        // Sheets and pictures. Cells were the only thing carried, so adding a sheet or
        // moving a picture was invisible to everyone else and the two workbooks quietly
        // stopped matching.
        editor.setSheetsReporter((sheets) => {
          if (this.viewOnly) return;
          writeSheets(doc, sheets, this.origin);
        });
        editor.setImagesReporter((images) => {
          if (this.viewOnly) return;
          void this.publishImages(doc, images);
        });
        editor.setChartsReporter((charts) => {
          if (this.viewOnly) return;
          writeCharts(doc, charts, this.origin);
        });
        editor.setDefinedNamesReporter((names) => {
          if (this.viewOnly) return;
          writeNames(doc, names, this.origin);
        });
        editor.setSheetSettingsReporter((settings) => {
          if (this.viewOnly) return;
          writeSettings(doc, settings, this.origin);
        });
        editor.setDrawingsReporter((drawings) => {
          if (this.viewOnly) return;
          writeDrawings(doc, drawings, this.origin);
        });
        editor.setPivotsReporter((pivots) => {
          if (this.viewOnly) return;
          writePivots(doc, pivots, this.origin);
        });
        editor.setQueriesReporter((sectionM) => {
          if (this.viewOnly) return;
          writeQueries(doc, sectionM, this.origin);
        });
        if (ctx.seed) {
          writeSheets(doc, editor.sheets(), this.origin);
          writeCharts(doc, editor.charts(), this.origin);
          writePivots(doc, editor.pivots(), this.origin);
          writeDrawings(doc, editor.drawings(), this.origin);
          writeSettings(doc, editor.sheetSettings(), this.origin);
          writeNames(doc, editor.definedNames(), this.origin);
          writeFormats(doc, editor.cellInputs(), this.origin);
          void editor.queries().then((m) => {
            if (m != null && this.shared === doc) writeQueries(doc, m, this.origin);
          });
          void this.publishImages(doc, editor.images());
        } else {
          this.applySheetsAndImages(doc);
        }
        const onSheets = (_e: unknown, transaction: Y.Transaction): void => {
          if (transaction.origin === this.origin) return;
          this.applySheetsAndImages(doc);
        };
        const [sheetsMap, order, imagesMap, chartsMap, queries, pivotsMap, drawingsMap, settingsMap, formatsMap, namesMap] =
          sheetSharedTypes(doc);
        sheetsMap.observeDeep(onSheets);
        order.observe(onSheets);
        imagesMap.observeDeep(onSheets);
        chartsMap.observeDeep(onSheets);
        queries.observe(onSheets);
        pivotsMap.observeDeep(onSheets);
        drawingsMap.observeDeep(onSheets);
        settingsMap.observe(onSheets);
        formatsMap.observe(onSheets);
        namesMap.observe(onSheets);
        this.unwatchSheets = () => {
          sheetsMap.unobserveDeep(onSheets);
          order.unobserve(onSheets);
          imagesMap.unobserveDeep(onSheets);
          chartsMap.unobserveDeep(onSheets);
          queries.unobserve(onSheets);
          pivotsMap.unobserveDeep(onSheets);
          drawingsMap.unobserveDeep(onSheets);
          settingsMap.unobserve(onSheets);
          formatsMap.unobserve(onSheets);
          namesMap.unobserve(onSheets);
        };

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
        this.propose = null;
        this.unwatchOrdered?.();
        this.unwatchOrdered = null;
        this.unwatchSheets?.();
        this.unwatchSheets = null;
        this.awaiting.clear();
        this.blobs = undefined;
        this.editor?.setSheetsReporter(null);
        this.editor?.setImagesReporter(null);
        this.editor?.setChartsReporter(null);
        this.editor?.setDefinedNamesReporter(null);
        this.editor?.setSheetSettingsReporter(null);
        this.editor?.setDrawingsReporter(null);
        this.editor?.setPivotsReporter(null);
        this.editor?.setQueriesReporter(null);
        this.editor?.setPeerCells([]);
        this.undoManager?.destroy();
        this.undoManager = null;
        this.shared = null;
        this.viewOnly = false;
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
