import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMountContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
import { localTransport } from "./local-transport";

// Two whole peers on a workbook, over the real transport and the real binding.
//
// The companion to session-pair.test.ts, and the sheet has one thing subtitles do not: an
// edit that cannot be merged. Inserting a row moves every address below it, so it is
// proposed rather than applied, put in one order by one peer, and applied by everyone
// there. That negotiation runs across the session, the binding and the transport at once,
// and it is not visible from any of them alone.

interface CellInput {
  sheet: string;
  r: number;
  c: number;
  input: string;
}
interface StructuralOp {
  kind: "insert" | "delete";
  axis: "row" | "col";
  sheet: string;
  at: number;
  count: number;
}
interface PeerCell {
  id: string;
  colour: string;
  name: string;
  sheet: string;
  r: number;
  c: number;
}

interface SheetInfo {
  id: string;
  name: string;
  visibility?: "hidden" | "veryHidden";
}
interface ChartInfo {
  id: string;
  sheet: string;
  model: string;
}
interface ImageInfo {
  id: string;
  sheet: string;
  anchor: Record<string, number>;
  dataUri: string;
}

/** A stand-in for sheetedit's grid: cells by address, and a log of what it was told. */
class StubSheet {
  sheetList: SheetInfo[] = [{ id: "s0", name: "Sheet1" }];
  imageList: ImageInfo[] = [];
  sheetsReporter: ((s: SheetInfo[]) => void) | null = null;
  chartList: ChartInfo[] = [];
  chartsReporter: ((c: ChartInfo[]) => void) | null = null;
  imagesReporter: ((i: ImageInfo[]) => void) | null = null;

  sheets(): SheetInfo[] {
    return this.sheetList.map((s) => ({ ...s }));
  }
  setSheetsReporter(h: ((s: SheetInfo[]) => void) | null): void {
    this.sheetsReporter = h;
  }
  applyRemoteSheets(next: SheetInfo[]): void {
    this.sheetList = next.map((s) => ({ ...s }));
  }
  charts(): ChartInfo[] {
    return this.chartList.map((c) => ({ ...c }));
  }
  setChartsReporter(h: ((c: ChartInfo[]) => void) | null): void {
    this.chartsReporter = h;
  }
  applyRemoteCharts(next: ChartInfo[]): void {
    this.chartList = next.map((c) => ({ ...c }));
  }
  addChart(id: string, title: string): void {
    this.chartList.push({ id, sheet: "s0", model: JSON.stringify({ id, title }) });
    this.chartsReporter?.(this.charts());
  }
  chartTitle(id: string): string | undefined {
    const found = this.chartList.find((c) => c.id === id);
    return found ? (JSON.parse(found.model) as { title?: string }).title : undefined;
  }

  images(): ImageInfo[] {
    return this.imageList.map((i) => ({ ...i, anchor: { ...i.anchor } }));
  }
  setImagesReporter(h: ((i: ImageInfo[]) => void) | null): void {
    this.imagesReporter = h;
  }
  applyRemoteImages(next: ImageInfo[]): void {
    const byId = new Map(this.imageList.map((i) => [i.id, i]));
    for (const im of next) byId.set(im.id, { ...im, anchor: { ...im.anchor } });
    this.imageList = [...byId.values()];
  }

  // --- what a person does ---

  addSheet(id: string, name: string): void {
    this.sheetList.push({ id, name });
    this.sheetsReporter?.(this.sheets());
  }
  renameSheet(id: string, name: string): void {
    const found = this.sheetList.find((s) => s.id === id);
    if (found) found.name = name;
    this.sheetsReporter?.(this.sheets());
  }
  putImage(id: string, dataUri: string, fromCol = 1): void {
    this.imageList.push({ id, sheet: "s0", anchor: { fromCol, fromRow: 1 }, dataUri });
    this.imagesReporter?.(this.images());
  }
  imageUri(id: string): string | undefined {
    return this.imageList.find((i) => i.id === id)?.dataUri;
  }

  cells = new Map<string, string>();
  peerCells: PeerCell[] = [];
  structural: StructuralOp[] = [];
  /** Structural edits this editor asked permission for, and the answer it got. */
  asked: { op: StructuralOp; allowed: boolean }[] = [];
  selected: { sheet: string; r: number; c: number } | null = { sheet: "Sheet1", r: 1, c: 1 };
  onCellsChanged: (changes: CellInput[]) => void = () => undefined;
  onSelectionChanged: (at: { sheet: string; r: number; c: number }) => void = () => undefined;
  allowStructuralEdit: (op: StructuralOp) => boolean = () => true;

  private static key(c: { sheet: string; r: number; c: number }): string {
    return `${c.r},${c.c}!${c.sheet}`;
  }

  cellInputs(): CellInput[] {
    return [...this.cells].map(([k, input]) => {
      const [rc, sheet] = k.split("!");
      const [r, c] = rc.split(",").map(Number);
      return { sheet, r, c, input };
    });
  }
  applyRemoteCells(changes: CellInput[]): void {
    for (const change of changes) this.cells.set(StubSheet.key(change), change.input);
  }
  applyRemoteStructural(op: StructuralOp): void {
    this.structural.push(op);
  }
  setPeerCells(peers: PeerCell[]): void {
    this.peerCells = peers;
  }
  selectedCell(): { sheet: string; r: number; c: number } | null {
    return this.selected;
  }
  getText(): string {
    return "";
  }
  getBytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
  destroy(): void {}

  // --- what a person does ---

  /** Type into a cell: change it, then report it the way the grid does. */
  type(sheet: string, r: number, c: number, input: string): void {
    this.cells.set(StubSheet.key({ sheet, r, c }), input);
    this.onCellsChanged([{ sheet, r, c, input }]);
  }
  /** Ask to insert a row, and record whether it was allowed. */
  insertRow(sheet: string, at: number): boolean {
    const op: StructuralOp = { kind: "insert", axis: "row", sheet, at, count: 1 };
    const allowed = this.allowStructuralEdit(op);
    this.asked.push({ op, allowed });
    return allowed;
  }
  value(sheet: string, r: number, c: number): string | undefined {
    return this.cells.get(StubSheet.key({ sheet, r, c }));
  }
}

const built: StubSheet[] = [];

vi.mock("sheetedit", () => ({
  createSheetEditorAsync: (
    _el: unknown,
    _bytes: Uint8Array,
    opts: {
      onCellsChanged?: (c: CellInput[]) => void;
      onSelectionChanged?: (at: { sheet: string; r: number; c: number }) => void;
      allowStructuralEdit?: (op: StructuralOp) => boolean;
    },
  ) => {
    const editor = new StubSheet();
    editor.cells.set("1,1!Sheet1", "apples");
    editor.cells.set("2,1!Sheet1", "pears");
    editor.onCellsChanged = opts.onCellsChanged ?? (() => undefined);
    editor.onSelectionChanged = opts.onSelectionChanged ?? (() => undefined);
    editor.allowStructuralEdit = opts.allowStructuralEdit ?? (() => true);
    built.push(editor);
    return Promise.resolve(editor);
  },
}));

async function baseDoc(): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode("workbook");
  return { name: "book.xlsx", bytes, hash: await hashBytes(bytes) };
}

interface Peer {
  session: CollabSession;
  editor: StubSheet;
}

async function makePeer(opts: {
  name: string;
  colour: string;
  key?: CollabSession["key"];
  readOnly?: boolean;
}): Promise<Peer> {
  const { sheetEditor } = await import("../../editors/sheet.impl");
  const instance = sheetEditor.create({} as never);
  const mountCtx = {
    text: "",
    bytes: new TextEncoder().encode("workbook"),
    binary: true,
    filename: "book.xlsx",
    model: null,
    format: null,
    view: "sheet",
    onChange: () => undefined,
  } as unknown as EditorMountContext;
  instance.mount({} as HTMLElement, mountCtx);
  // The factory is async, so the editor exists only after a turn of the loop.
  await new Promise((r) => setTimeout(r, 0));
  const editor = built[built.length - 1];

  const api: SessionHost = {
    currentDoc: baseDoc,
    localState: () => null,
    openBase: () => undefined,
    binding: () => instance.collab?.() ?? null,
    editorId: () => "sheet",
    notify: () => undefined,
  };
  const session = new CollabSession(api, {
    name: opts.name,
    colour: opts.colour,
    key: opts.key,
    readOnly: opts.readOnly,
    makeTransport: (key) => localTransport(key.roomId),
  });
  await session.start();
  return { session, editor };
}

const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("two peers on a workbook", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  async function connected(readOnlyJoiner = false): Promise<{ a: Peer; b: Peer }> {
    const a = await makePeer({ name: "Ada", colour: "#f00" });
    await settle();
    const b = await makePeer({ name: "Bo", colour: "#00f", key: a.session.key, readOnly: readOnlyJoiner });
    await settle(250);
    return { a, b };
  }

  it("carries a cell edit from one peer's grid to the other's", async () => {
    const { a, b } = await connected();

    a.editor.type("Sheet1", 1, 2, "=A1");
    await settle();

    expect(b.editor.value("Sheet1", 1, 2), "the input, not the computed value").toBe("=A1");
  });

  it("shows each peer which cell the other is on", async () => {
    const { a, b } = await connected();

    a.editor.onSelectionChanged({ sheet: "Sheet1", r: 4, c: 2 });
    await settle();

    expect(b.editor.peerCells).toHaveLength(1);
    expect(b.editor.peerCells[0]).toMatchObject({ name: "Ada", colour: "#f00", sheet: "Sheet1", r: 4, c: 2 });
  });

  // A row insert cannot be merged, so it is refused where it was made and comes back
  // through the ordered path. Both peers must apply it, and neither twice.
  it("puts a row insert in one order and gives it to both peers", async () => {
    const { a, b } = await connected();

    const allowed = a.editor.insertRow("Sheet1", 2);
    expect(allowed, "refused locally: it arrives by the ordered path instead").toBe(false);
    await settle(200);

    expect(a.editor.structural, "the proposer applies it once").toHaveLength(1);
    expect(b.editor.structural, "and so does the other peer").toHaveLength(1);
    expect(a.editor.structural[0]).toMatchObject({ kind: "insert", axis: "row", sheet: "Sheet1", at: 2 });
    expect(b.editor.structural[0]).toMatchObject({ kind: "insert", axis: "row", sheet: "Sheet1", at: 2 });
  });

  it("mirrors edits into a view-only peer and publishes none back", async () => {
    const { a, b } = await connected(true);

    a.editor.type("Sheet1", 1, 3, "Ada can write.");
    await settle();
    expect(b.editor.value("Sheet1", 1, 3), "a watcher still sees the work").toBe("Ada can write.");

    b.editor.type("Sheet1", 2, 3, "Bo cannot.");
    await settle();
    expect(a.editor.value("Sheet1", 2, 3), "and cannot change it").toBeUndefined();
  });

  // Refused rather than allowed. Falling through to "allowed" would insert the row in the
  // watcher's grid alone, leaving every address below it a row out of step with everyone.
  it("refuses a structural edit from a view-only peer instead of letting it diverge", async () => {
    const { a, b } = await connected(true);

    expect(b.editor.insertRow("Sheet1", 2), "not allowed locally").toBe(false);
    await settle(200);

    expect(b.editor.structural, "and not applied by any route").toHaveLength(0);
    expect(a.editor.structural, "nor proposed to anyone else").toHaveLength(0);
  });
});

// Sheets and pictures, which a session carried none of until now: adding a sheet or moving
// a picture was invisible to the other person and the two workbooks quietly diverged.
describe("two peers, sheets and pictures", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  async function connected(): Promise<{ a: Peer; b: Peer }> {
    const a = await makePeer({ name: "Ada", colour: "#f00" });
    await settle();
    const b = await makePeer({ name: "Bo", colour: "#00f", key: a.session.key });
    await settle(300);
    return { a, b };
  }

  it("carries a new sheet to the other peer", async () => {
    const { a, b } = await connected();

    a.editor.addSheet("s-new", "Budget 2027");
    await settle(300);

    expect(b.editor.sheets().map((s) => s.id)).toEqual(["s0", "s-new"]);
    expect(b.editor.sheets()[1].name).toBe("Budget 2027");
  });

  it("carries a rename", async () => {
    const { a, b } = await connected();

    a.editor.renameSheet("s0", "Renamed by Ada");
    await settle(300);

    expect(b.editor.sheets()[0].name).toBe("Renamed by Ada");
    expect(b.editor.sheets()[0].id, "under the id it always had").toBe("s0");
  });

  it("keeps both when each peer adds a sheet", async () => {
    const { a, b } = await connected();

    a.editor.addSheet("s-ada", "Ada's");
    b.editor.addSheet("s-bo", "Bo's");
    await settle(400);

    const ids = (p: Peer) => p.editor.sheets().map((s) => s.id).sort();
    expect(ids(a), "two, not one").toEqual(["s-ada", "s-bo", "s0"]);
    expect(ids(b)).toEqual(["s-ada", "s-bo", "s0"]);
  });

  describe("pictures", () => {
    const uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    it("carries a chart to the other peer", async () => {
      const { a, b } = await connected();

      a.editor.addChart("chart-new-1-abc", "Ada's chart");
      await settle(300);

      expect(b.editor.charts().map((c) => c.id)).toEqual(["chart-new-1-abc"]);
      expect(b.editor.chartTitle("chart-new-1-abc")).toBe("Ada's chart");
    });

    it("keeps both when each peer adds a chart", async () => {
      const { a, b } = await connected();

      a.editor.addChart("chart-ada", "Ada's");
      b.editor.addChart("chart-bo", "Bo's");
      await settle(400);

      const ids = (p: Peer) => p.editor.charts().map((c) => c.id).sort();
      expect(ids(a), "two, not one").toEqual(["chart-ada", "chart-bo"]);
      expect(ids(b)).toEqual(["chart-ada", "chart-bo"]);
    });

    it("carries a picture to the other peer, payload and all", async () => {
      const { a, b } = await connected();

      a.editor.putImage("img-1", uri);
      await settle(500);

      expect(b.editor.imageUri("img-1"), "restored exactly").toBe(uri);
    });

    // The point of the blob channel: a CRDT never forgets, so a picture replaced twice
    // would cost three pictures' worth of session for ever.
    it("keeps the payload out of the shared document", async () => {
      const { a, b } = await connected();

      a.editor.putImage("img-1", uri);
      await settle(500);

      const shared = new TextDecoder("utf-8", { fatal: false }).decode(
        (await import("yjs")).encodeStateAsUpdate(b.session.provider.doc),
      );
      expect(shared, "no payload in the document").not.toContain("iVBORw0KGgo");
      expect(shared, "a hash instead").toContain(await hashBytes(new TextEncoder().encode(uri)));
    });
  });
});
