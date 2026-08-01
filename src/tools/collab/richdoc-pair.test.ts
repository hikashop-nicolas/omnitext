import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMountContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
import { localTransport } from "./local-transport";

// Two whole peers on a rich document, over the real transport and the real binding.
//
// The third of these, and the one with the most to prove: a rich document is the only
// editor here where two people typing in the same block is ordinary rather than a corner
// case, so the merge is the feature and not a detail of it.

interface BlockState {
  id: string;
  html: string;
}
interface BlockChanges {
  changed: BlockState[];
  removed: string[];
  order: string[];
}
interface BlockPosition {
  blockId: string;
  offset: number;
}
interface PeerCaretState extends BlockPosition {
  id: string;
  name: string;
  colour: string;
}
interface UndoHandler {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/**
 * A stand-in for richdoc's editor: a list of blocks, and the reporting contract around it.
 *
 * The contract is the real one, including the part that matters most: applying a peer's
 * blocks does not report, and the next local edit is described against what the peer left
 * behind. richdoc's own tests hold it to that; this one assumes it.
 */
class StubRich {
  extras: { kind: string; id: string; value: string }[] = [
    { kind: "geometry", id: "", value: JSON.stringify({ widthPx: 794 }) },
    { kind: "band", id: "header", value: "<p>Head</p>" },
  ];
  extrasReporter: ((e: StubRich["extras"]) => void) | null = null;
  blocks: BlockState[] = [];
  undoHandler: UndoHandler | null = null;
  reporter: ((changes: BlockChanges) => void) | null = null;
  selectionReporter: ((at: BlockPosition | null) => void) | null = null;
  peerCarets: PeerCaretState[] = [];
  /** How many times a peer's body was put on screen, to catch an edit echoing round. */
  applied = 0;

  docExtras(): StubRich["extras"] {
    return this.extras.map((e) => ({ ...e }));
  }
  setDocExtrasReporter(h: ((e: StubRich["extras"]) => void) | null): void {
    this.extrasReporter = h;
  }
  applyRemoteDocExtras(next: StubRich["extras"]): void {
    for (const item of next) {
      const found = this.extras.find((e) => e.kind === item.kind && e.id === item.id);
      if (found) found.value = item.value;
      else this.extras.push({ ...item });
    }
  }
  setExtra(kind: string, id: string, value: string): void {
    const found = this.extras.find((e) => e.kind === kind && e.id === id);
    if (found) found.value = value;
    else this.extras.push({ kind, id, value });
    this.extrasReporter?.(this.docExtras());
  }
  extra(kind: string, id: string): string | undefined {
    return this.extras.find((e) => e.kind === kind && e.id === id)?.value;
  }

  blockSnapshot(): BlockState[] {
    return this.blocks.map((b) => ({ ...b }));
  }
  applyRemoteBlocks(changes: BlockChanges): void {
    this.applied++;
    const byId = new Map(this.blocks.map((b) => [b.id, { ...b }]));
    for (const block of changes.changed) byId.set(block.id, { ...block });
    for (const id of changes.removed) byId.delete(id);
    this.blocks = changes.order.map((id) => byId.get(id)).filter((b): b is BlockState => !!b);
  }
  setBlockReporter(handler: ((changes: BlockChanges) => void) | null): void {
    this.reporter = handler;
  }
  setSelectionReporter(handler: ((at: BlockPosition | null) => void) | null): void {
    this.selectionReporter = handler;
  }
  setPeerCarets(carets: readonly PeerCaretState[]): void {
    this.peerCarets = [...carets];
  }
  setUndoHandler(handler: UndoHandler | null): void {
    this.undoHandler = handler;
  }
  destroy(): void {}

  // --- what a person does ---

  /** Edit one block and report it, the way richdoc reports a local edit. */
  type(id: string, html: string): void {
    const block = this.blocks.find((b) => b.id === id);
    if (block) block.html = html;
    this.reporter?.({ changed: block ? [{ ...block }] : [], removed: [], order: this.blocks.map((b) => b.id) });
  }
  /** Move the caret, the way clicking into a paragraph does. */
  click(blockId: string, offset: number): void {
    this.selectionReporter?.({ blockId, offset });
  }
  /** Add a block after the given one. */
  insertAfter(afterId: string, block: BlockState): void {
    const at = this.blocks.findIndex((b) => b.id === afterId);
    this.blocks.splice(at + 1, 0, { ...block });
    this.reporter?.({ changed: [{ ...block }], removed: [], order: this.blocks.map((b) => b.id) });
  }
  remove(id: string): void {
    this.blocks = this.blocks.filter((b) => b.id !== id);
    this.reporter?.({ changed: [], removed: [id], order: this.blocks.map((b) => b.id) });
  }
  html(id: string): string | undefined {
    return this.blocks.find((b) => b.id === id)?.html;
  }
  text(): string[] {
    return this.blocks.map((b) => b.html);
  }
}

const built: StubRich[] = [];

/**
 * How long the editor takes to appear after mount returns.
 *
 * Not a detail. A richdoc editor is inflated off the main thread, so it does not exist for
 * some time after mount, and a joiner binds the instant the base file arrives, which is
 * inside that window. Resolving immediately here hid a bug that made every real session
 * silent in both directions; a delay reproduces it.
 */
let inflateMs = 30;

vi.mock("richdoc", () => ({
  initLocale: () => Promise.resolve(),
  createDocxEditorAsync: async () => {
    await new Promise((r) => setTimeout(r, inflateMs));
    const editor = new StubRich();
    editor.blocks = [
      { id: "b1", html: "The first paragraph." },
      { id: "b2", html: "The second paragraph." },
      { id: "b3", html: "The third paragraph." },
    ];
    built.push(editor);
    return editor;
  },
}));

async function baseDoc(): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode("document");
  return { name: "notes.docx", bytes, hash: await hashBytes(bytes) };
}

interface Peer {
  session: CollabSession;
  editor: StubRich;
}

async function makePeer(opts: {
  name: string;
  colour: string;
  key?: CollabSession["key"];
  readOnly?: boolean;
}): Promise<Peer> {
  const { docxEditor } = await import("../../editors/docx.impl");
  const instance = docxEditor.create({ notifications: { error: () => undefined } } as never);
  const mountCtx = {
    text: "",
    bytes: new TextEncoder().encode("document"),
    binary: true,
    filename: "notes.docx",
    model: null,
    format: null,
    view: "richtext",
    onChange: () => undefined,
  } as unknown as EditorMountContext;
  instance.mount({} as HTMLElement, mountCtx);

  const api: SessionHost = {
    currentDoc: baseDoc,
    localState: () => null,
    openBase: () => undefined,
    binding: () => instance.collab?.() ?? null,
    editorId: () => "docx",
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
  // Deliberately after start(), so the session begins while the editor is still inflating,
  // which is what happens in the browser.
  await new Promise((r) => setTimeout(r, inflateMs + 20));
  const editor = built[built.length - 1];
  return { session, editor };
}

const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("two peers on a rich document", () => {
  beforeEach(() => {
    built.length = 0;
    inflateMs = 30;
  });
  afterEach(() => void built.splice(0));

  async function connected(readOnlyJoiner = false): Promise<{ a: Peer; b: Peer }> {
    const a = await makePeer({ name: "Ada", colour: "#f00" });
    await settle();
    const b = await makePeer({ name: "Bo", colour: "#00f", key: a.session.key, readOnly: readOnlyJoiner });
    await settle(250);
    return { a, b };
  }

  it("carries an edit from one peer's document to the other's", async () => {
    const { a, b } = await connected();

    a.editor.type("b2", "The second paragraph, edited by Ada.");
    await settle();

    expect(b.editor.html("b2")).toBe("The second paragraph, edited by Ada.");
    expect(b.editor.html("b1"), "and nothing else moved").toBe("The first paragraph.");
  });

  it("does not publish a change that came from the other peer", async () => {
    const { a, b } = await connected();
    const before = a.editor.applied;

    a.editor.type("b1", "Once.");
    await settle(200);

    expect(b.editor.html("b1")).toBe("Once.");
    expect(a.editor.applied, "the edit did not come back").toBe(before);
  });

  it("merges edits each peer makes to a different paragraph", async () => {
    const { a, b } = await connected();

    a.editor.type("b1", "First, by Ada.");
    b.editor.type("b3", "Third, by Bo.");
    await settle(200);

    const expected = ["First, by Ada.", "The second paragraph.", "Third, by Bo."];
    expect(a.editor.text(), "A has both").toEqual(expected);
    expect(b.editor.text(), "and so does B").toEqual(expected);
  });

  // The reason a block is a Y.Text rather than a string. A paragraph is long enough that
  // two people working in one at the same time is ordinary, and both must survive it.
  it("keeps both peers' words when they type in the same paragraph", async () => {
    const { a, b } = await connected();

    a.editor.type("b2", "The second paragraph, with Ada's ending.");
    b.editor.type("b2", "Bo's opening. The second paragraph.");
    await settle(250);

    const merged = a.editor.html("b2") ?? "";
    expect(merged, "Ada's words survive").toContain("Ada's ending");
    expect(merged, "and so do Bo's").toContain("Bo's opening");
    expect(b.editor.html("b2"), "and both hold the same paragraph").toBe(merged);
  });

  it("carries an inserted paragraph, in the right place", async () => {
    const { a, b } = await connected();

    a.editor.insertAfter("b1", { id: "b9", html: "A new second paragraph." });
    await settle(200);

    expect(b.editor.text()).toEqual([
      "The first paragraph.",
      "A new second paragraph.",
      "The second paragraph.",
      "The third paragraph.",
    ]);
  });

  it("carries a deleted paragraph", async () => {
    const { a, b } = await connected();

    a.editor.remove("b2");
    await settle(200);

    expect(b.editor.text()).toEqual(["The first paragraph.", "The third paragraph."]);
  });

  it("undoes only the peer's own edit, leaving the other's alone", async () => {
    const { a, b } = await connected();

    b.editor.type("b1", "Bo typed this.");
    await settle();
    a.editor.type("b3", "Ada typed this.");
    await settle(200);

    expect(b.editor.undoHandler, "the session took undo over").not.toBeNull();
    b.editor.undoHandler?.undo();
    await settle(200);

    expect(b.editor.html("b1"), "B's own edit is taken back").toBe("The first paragraph.");
    expect(b.editor.html("b3"), "A's edit survives it").toBe("Ada typed this.");
  });

  it("shows each peer where the other's cursor is, by name and colour", async () => {
    const { a, b } = await connected();

    a.editor.click("b2", 7);
    await settle(200);

    expect(b.editor.peerCarets).toHaveLength(1);
    expect(b.editor.peerCarets[0]).toMatchObject({
      name: "Ada",
      colour: "#f00",
      blockId: "b2",
      offset: 7,
    });
    expect(a.editor.peerCarets, "and A is not shown its own").toHaveLength(0);
  });

  it("moves a peer's cursor rather than adding another", async () => {
    const { a, b } = await connected();

    a.editor.click("b1", 1);
    await settle(150);
    a.editor.click("b3", 4);
    await settle(150);

    expect(b.editor.peerCarets).toHaveLength(1);
    expect(b.editor.peerCarets[0]).toMatchObject({ blockId: "b3", offset: 4 });
  });

  // The image fix. Bytes in the CRDT stay there for the life of the session even after the
  // picture is deleted, and they make the block too binary to merge, so two people editing
  // the text around a picture lose one of the two edits. Both go away by moving the payload
  // to the blob store and leaving a short reference behind.
  describe("images in a block", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    it("carries the picture to the other peer", async () => {
      const { a, b } = await connected();

      a.editor.type("b2", `Look: <img src="${png}"> there.`);
      await settle(400);

      expect(b.editor.html("b2"), "the payload arrived, restored exactly").toBe(
        `Look: <img src="${png}"> there.`,
      );
    });

    it("keeps the payload out of the shared document", async () => {
      const { a, b } = await connected();

      a.editor.type("b2", `Look: <img src="${png}"> there.`);
      await settle(400);

      const shared = new TextDecoder("utf-8", { fatal: false }).decode(
        (await import("yjs")).encodeStateAsUpdate(b.session.provider.doc),
      );
      expect(shared, "no base64 in the document").not.toContain("iVBORw0KGgo");
      expect(shared, "a reference instead").toContain("rdoc-blob:");
    });

    it("still merges two people editing the text around a picture", async () => {
      const { a, b } = await connected();
      a.editor.type("b2", `start <img src="${png}"> finish`);
      await settle(400);

      a.editor.type("b2", `the start <img src="${png}"> finish`);
      b.editor.type("b2", `start <img src="${png}"> the finish`);
      await settle(400);

      const merged = a.editor.html("b2") ?? "";
      expect(merged, "Ada's word survives").toContain("the start");
      expect(merged, "and so does Bo's").toContain("the finish");
      expect(b.editor.html("b2"), "and both hold the same paragraph").toBe(merged);
    });
  });

  // The document beside its body.
  it("carries a header to the other peer", async () => {
    const { a, b } = await connected();

    a.editor.setExtra("band", "header", "<p>Written by Ada</p>");
    await settle(300);

    expect(b.editor.extra("band", "header")).toBe("<p>Written by Ada</p>");
  });

  // Keyed per entry, so a header and the page size do not overwrite each other.
  it("keeps a header and a page size changed at the same time", async () => {
    const { a, b } = await connected();

    a.editor.setExtra("band", "header", "<p>Ada's header</p>");
    b.editor.setExtra("geometry", "", JSON.stringify({ widthPx: 999 }));
    await settle(400);

    expect(a.editor.extra("band", "header"), "A kept its own").toContain("Ada's header");
    expect(JSON.parse(String(a.editor.extra("geometry", ""))).widthPx, "and took B's").toBe(999);
    expect(b.editor.extra("band", "header"), "and B has both").toContain("Ada's header");
  });

  it("gives undo, the reporter and the carets back when the session ends", async () => {
    const { a, b } = await connected();
    a.editor.click("b1", 0);
    await settle(150);
    expect(b.editor.undoHandler).not.toBeNull();
    expect(b.editor.reporter).not.toBeNull();
    expect(b.editor.peerCarets).toHaveLength(1);

    await b.session.leave();
    await settle();

    expect(b.editor.undoHandler, "its own undo again").toBeNull();
    expect(b.editor.reporter, "and no longer paying for the diff").toBeNull();
    expect(b.editor.selectionReporter, "nor for the caret").toBeNull();
    expect(b.editor.peerCarets, "and nobody is drawn any more").toEqual([]);
  });

  it("adopts the session's document rather than seeding its own", async () => {
    const a = await makePeer({ name: "Ada", colour: "#f00" });
    await settle();
    a.editor.type("b1", "Changed before Bo arrived.");
    await settle();

    const b = await makePeer({ name: "Bo", colour: "#00f", key: a.session.key });
    await settle(250);

    expect(b.editor.html("b1")).toBe("Changed before Bo arrived.");
    expect(b.editor.blocks, "and the body is not doubled").toHaveLength(3);
  });

  it("mirrors edits into a view-only peer and publishes none back", async () => {
    const { a, b } = await connected(true);

    a.editor.type("b1", "Ada can write.");
    await settle(200);
    expect(b.editor.html("b1"), "a watcher still sees the work").toBe("Ada can write.");

    b.editor.type("b3", "Bo cannot.");
    await settle(200);
    expect(a.editor.html("b3"), "and cannot change it").toBe("The third paragraph.");
  });
});
