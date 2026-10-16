// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import Quill from "quill";
import type { EditorMountContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
import { localTransport } from "./local-transport";

// Two peers on an HTML document, with the real Quill, the real y-quill binding and the
// real cursors module behind it.
//
// Why these are not stubbed, unlike the other pair tests: here the collaboration is the
// libraries. Our side is ten lines of wiring, and what can break is the contract between
// y-quill and quill-cursors, which y-quill (unmaintained, pinned to quill-cursors 4)
// cannot be relied on to declare correctly. A quill-cursors major has to be answered by a
// run of this, because the browser cannot: pairing two tabs needs WebRTC.

/** The remote carets quill-cursors is holding, as the cursors module reports them. */
interface Caret {
  id: string;
  name: string;
  range: { index: number; length: number } | null;
}
interface CursorsModule {
  cursors(): Caret[];
}

async function baseDoc(): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode("<p>Shared paragraph.</p>");
  return { name: "page.html", bytes, hash: await hashBytes(bytes) };
}

interface Peer {
  session: CollabSession;
  quill: Quill;
}

async function makePeer(opts: { name: string; colour: string; key?: CollabSession["key"] }): Promise<Peer> {
  const { quillEditor } = await import("../../editors/quill.impl");
  const instance = quillEditor.create({ notifications: { error: () => undefined } } as never);
  const container = document.createElement("div");
  document.body.appendChild(container);
  instance.mount(container, {
    text: "<p>Shared paragraph.</p>",
    binary: false,
    filename: "page.html",
    model: null,
    format: null,
    view: "richtext",
    onChange: () => undefined,
  } as unknown as EditorMountContext);

  const api: SessionHost = {
    currentDoc: baseDoc,
    localState: () => null,
    openBase: () => undefined,
    binding: () => instance.collab?.() ?? null,
    editorId: () => "quill",
    notify: () => undefined,
  };
  const session = new CollabSession(api, {
    name: opts.name,
    colour: opts.colour,
    key: opts.key,
    makeTransport: (key) => localTransport(key.roomId),
  });
  await session.start();
  const quill = Quill.find(container.querySelector(".ql-container") as HTMLElement) as Quill;
  return { session, quill };
}

const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function connected(): Promise<{ a: Peer; b: Peer }> {
  const a = await makePeer({ name: "Ada", colour: "#f00" });
  await settle();
  const b = await makePeer({ name: "Bo", colour: "#00f", key: a.session.key });
  await settle(300);
  return { a, b };
}

const carets = (peer: Peer): Caret[] => (peer.quill.getModule("cursors") as CursorsModule).cursors();

describe("two peers on an HTML document", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("starts the joiner on the host's document", async () => {
    const { b } = await connected();

    expect(b.quill.getText()).toContain("Shared paragraph.");
  });

  it("carries typing each way", async () => {
    const { a, b } = await connected();

    a.quill.insertText(0, "Ada wrote this. ");
    await settle();
    expect(b.quill.getText(), "A to B").toContain("Ada wrote this.");

    b.quill.insertText(b.quill.getLength() - 1, " Bo answered.");
    await settle();
    expect(a.quill.getText(), "B to A").toContain("Bo answered.");
  });

  it("keeps both peers' words typed at once in the same paragraph", async () => {
    const { a, b } = await connected();

    a.quill.insertText(0, "Ada first. ");
    b.quill.insertText(b.quill.getLength() - 1, " Bo last.");
    await settle(250);

    for (const peer of [a, b]) {
      expect(peer.quill.getText()).toContain("Ada first.");
      expect(peer.quill.getText()).toContain("Bo last.");
    }
  });

  // The three calls y-quill makes into quill-cursors, and the only ones it makes. A
  // quill-cursors release that renames or drops them leaves the document syncing with no
  // sign of who else is in it, which no other test here would notice.
  it("shows the other peer's caret, where they put it", async () => {
    const { a, b } = await connected();

    a.quill.setSelection(2, 4);
    await settle(250);

    const [seen] = carets(b);
    expect(seen, "B holds a caret for A").toBeTruthy();
    expect(seen?.name).toBe("Ada");
    expect(seen?.range).toEqual({ index: 2, length: 4 });
  });

  it("drops the caret when the peer leaves", async () => {
    const { a, b } = await connected();
    a.quill.setSelection(0, 1);
    await settle(250);
    expect(carets(b)).toHaveLength(1);

    await a.session.leave();
    await settle(300);

    expect(carets(b)).toHaveLength(0);
  });
});
