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

/** A stand-in for sheetedit's grid: cells by address, and a log of what it was told. */
class StubSheet {
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
