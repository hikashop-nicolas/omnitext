import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMountContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
import { localTransport } from "./local-transport";

// Two whole peers on a PDF, over the real transport and the real binding.
//
// The one thing here that no other editor has: an image, whose bytes travel on their own
// channel rather than in the CRDT. So this checks not only that an image arrives, but that
// the hash is what crossed in the shared document and that a peer who cannot get the bytes
// yet draws nothing rather than an empty rectangle.

interface ParagraphEdit {
  page: number;
  index: number;
  html: string;
  align?: string;
}
interface PdfImage {
  id: string;
  page: number;
  bytes: Uint8Array;
  mime: string;
  leftPx: number;
  topPx: number;
  widthPx: number;
}
interface Snapshot {
  edits: ParagraphEdit[];
  boxes: { id: string; page: number; xPdf: number; yPdf: number; wPdf: number; size: number; align: string; family: string; colorHex: string; html: string }[];
  images: PdfImage[];
  whiteouts: { id: string; page: number; leftPx: number; topPx: number; widthPx: number; heightPx: number }[];
}
interface UndoHandler {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

const empty = (): Snapshot => ({ edits: [], boxes: [], images: [], whiteouts: [] });

/** A stand-in for pdfedit: holds a snapshot, reports changes, records what it was shown. */
class StubPdf {
  snap: Snapshot = empty();
  reporter: ((s: Snapshot) => void) | null = null;
  undoHandler: UndoHandler | null = null;
  /** Every state a peer put on screen, so a half-applied image would be visible here. */
  applied: Snapshot[] = [];

  getSnapshot(): Snapshot {
    return JSON.parse(JSON.stringify(this.snap), (k, v) =>
      k === "bytes" && v && typeof v === "object" ? new Uint8Array(Object.values(v as object) as number[]) : v,
    ) as Snapshot;
  }
  applyRemote(snap: Snapshot): void {
    this.applied.push(snap);
    this.snap = snap;
  }
  setChangeReporter(handler: ((s: Snapshot) => void) | null): void {
    this.reporter = handler;
  }
  setUndoHandler(handler: UndoHandler | null): void {
    this.undoHandler = handler;
  }
  destroy(): void {}

  // --- what a person does ---

  editParagraph(page: number, index: number, html: string): void {
    const found = this.snap.edits.find((e) => e.page === page && e.index === index);
    if (found) found.html = html;
    else this.snap.edits.push({ page, index, html });
    this.reporter?.(this.snap);
  }
  addWhiteout(id: string): void {
    this.snap.whiteouts.push({ id, page: 0, leftPx: 1, topPx: 2, widthPx: 3, heightPx: 4 });
    this.reporter?.(this.snap);
  }
  addImage(id: string, bytes: Uint8Array): void {
    this.snap.images.push({ id, page: 0, bytes, mime: "image/png", leftPx: 5, topPx: 6, widthPx: 100 });
    this.reporter?.(this.snap);
  }
  imageBytes(id: string): Uint8Array | undefined {
    return this.snap.images.find((i) => i.id === id)?.bytes;
  }
}

const built: StubPdf[] = [];

vi.mock("pdfedit", () => ({
  createPdfEditor: () => {
    const editor = new StubPdf();
    built.push(editor);
    return editor;
  },
}));

async function baseDoc(): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode("%PDF-1.7 pretend");
  return { name: "notes.pdf", bytes, hash: await hashBytes(bytes) };
}

interface Peer {
  session: CollabSession;
  editor: StubPdf;
}

async function makePeer(opts: { name: string; colour: string; key?: CollabSession["key"]; readOnly?: boolean }): Promise<Peer> {
  const { pdfEditor } = await import("../../editors/pdf.impl");
  const instance = pdfEditor.create({
    notifications: { warn: () => undefined, error: () => undefined },
  } as never);
  const mountCtx = {
    text: "",
    bytes: new TextEncoder().encode("%PDF-1.7 pretend"),
    binary: true,
    filename: "notes.pdf",
    model: null,
    format: null,
    view: "pdf",
    onChange: () => undefined,
  } as unknown as EditorMountContext;
  instance.mount({} as HTMLElement, mountCtx);
  const editor = built[built.length - 1];

  const api: SessionHost = {
    currentDoc: baseDoc,
    localState: () => null,
    openBase: () => undefined,
    binding: () => instance.collab?.() ?? null,
    editorId: () => "pdf",
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

const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("two peers on a PDF", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  async function connected(readOnlyJoiner = false): Promise<{ a: Peer; b: Peer }> {
    const a = await makePeer({ name: "Ada", colour: "#f00" });
    await settle();
    const b = await makePeer({ name: "Bo", colour: "#00f", key: a.session.key, readOnly: readOnlyJoiner });
    await settle(300);
    return { a, b };
  }

  it("carries a paragraph edit from one peer to the other", async () => {
    const { a, b } = await connected();

    a.editor.editParagraph(0, 1, "Edited by Ada.");
    await settle();

    expect(b.editor.snap.edits).toEqual([{ page: 0, index: 1, html: "Edited by Ada.", align: undefined }]);
  });

  it("merges edits each peer makes to a different paragraph", async () => {
    const { a, b } = await connected();

    a.editor.editParagraph(0, 0, "First, by Ada.");
    b.editor.editParagraph(0, 1, "Second, by Bo.");
    await settle(300);

    const html = (p: Peer) => p.editor.snap.edits.slice().sort((x, y) => x.index - y.index).map((e) => e.html);
    expect(html(a)).toEqual(["First, by Ada.", "Second, by Bo."]);
    expect(html(b)).toEqual(["First, by Ada.", "Second, by Bo."]);
  });

  it("keeps both added objects when each peer adds one", async () => {
    const { a, b } = await connected();

    a.editor.addWhiteout("w-ada");
    b.editor.addWhiteout("w-bo");
    await settle(300);

    const ids = (p: Peer) => p.editor.snap.whiteouts.map((w) => w.id).sort();
    expect(ids(a), "two, not one").toEqual(["w-ada", "w-bo"]);
    expect(ids(b)).toEqual(["w-ada", "w-bo"]);
  });

  describe("images", () => {
    const picture = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);

    it("carries an image to the other peer, bytes and all", async () => {
      const { a, b } = await connected();

      a.editor.addImage("img-1", picture);
      await settle(400);

      expect(b.editor.snap.images.map((i) => i.id)).toEqual(["img-1"]);
      expect(b.editor.imageBytes("img-1"), "the bytes arrived, not just the reference").toEqual(picture);
    });

    // The whole reason for the blob channel: a CRDT never forgets, so bytes in it would
    // weigh on the session for its whole life even after the image was deleted.
    it("sends the hash through the document and the bytes beside it", async () => {
      const { a, b } = await connected();

      a.editor.addImage("img-1", picture);
      await settle(400);

      const doc = b.session.provider.doc;
      const objects = doc.getMap("pdf.objects").get("img-1") as { get(k: string): unknown };
      const sha = objects.get("sha");
      expect(typeof sha, "the shared document names the image by hash").toBe("string");
      expect(sha).toBe(await hashBytes(picture));
      expect(objects.get("bytes"), "and holds no bytes of its own").toBeUndefined();
    });

    // Half an image is worse than none: pdfedit would draw nothing for an empty payload,
    // which looks exactly like an image that was deleted.
    it("draws nothing for an image whose bytes have not arrived", async () => {
      const { a, b } = await connected();
      // A reference to bytes nobody has: the peer that had them is gone.
      const orphan = await hashBytes(new Uint8Array([9, 9, 9]));
      const objects = a.session.provider.doc.getMap("pdf.objects");
      // Written through the shared shape so it looks exactly like a real one.
      const { writeShared } = await import("../../editors/pdf-collab");
      writeShared(
        a.session.provider.doc,
        {
          edits: [],
          boxes: [],
          images: [{ id: "ghost", page: 0, mime: "image/png", sha: orphan, leftPx: 0, topPx: 0, widthPx: 10 }],
          whiteouts: [],
        },
        { someone: "else" },
      );
      await settle(400);

      expect(objects.has("ghost"), "the reference did cross").toBe(true);
      expect(b.editor.snap.images, "but nothing was drawn for it").toEqual([]);
      expect(
        b.editor.applied.every((s) => s.images.every((i) => i.bytes.length > 0)),
        "and no empty payload was ever handed to the editor",
      ).toBe(true);
    });
  });

  it("undoes only the peer's own edit, leaving the other's alone", async () => {
    const { a, b } = await connected();

    b.editor.editParagraph(0, 0, "Bo typed this.");
    await settle();
    a.editor.editParagraph(0, 1, "Ada typed this.");
    await settle(300);

    expect(b.editor.undoHandler).not.toBeNull();
    b.editor.undoHandler?.undo();
    await settle(300);

    const byIndex = (p: Peer, i: number) => p.editor.snap.edits.find((e) => e.index === i)?.html;
    expect(byIndex(b, 0), "B's own edit is taken back").toBeUndefined();
    expect(byIndex(b, 1), "A's edit survives it").toBe("Ada typed this.");
  });

  it("mirrors edits into a view-only peer and publishes none back", async () => {
    const { a, b } = await connected(true);

    a.editor.editParagraph(0, 0, "Ada can write.");
    await settle(300);
    expect(b.editor.snap.edits[0]?.html, "a watcher still sees the work").toBe("Ada can write.");

    b.editor.editParagraph(0, 1, "Bo cannot.");
    await settle(300);
    expect(a.editor.snap.edits.find((e) => e.index === 1), "and cannot change it").toBeUndefined();
  });

  it("gives undo and the reporter back when the session ends", async () => {
    const { b } = await connected();
    expect(b.editor.undoHandler).not.toBeNull();
    expect(b.editor.reporter).not.toBeNull();

    await b.session.leave();
    await settle();

    expect(b.editor.undoHandler).toBeNull();
    expect(b.editor.reporter).toBeNull();
  });
});
