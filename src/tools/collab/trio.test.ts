import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMountContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
import { localTransport } from "./local-transport";

// Three peers, not two.
//
// Everything below the editors is written for any number of people and has never met more
// than two. Two is the number where a great many mistakes are invisible: a reply that goes
// to "the other peer" rather than to everyone, a request answered by whoever happens to
// hold it with no thought for the second holder answering as well, a name clash resolved
// pairwise so that the third arrival takes a name one of the first two already moved to.
//
// None of that is a new mechanism to build. It is the same mechanisms, asked the question
// they were written for and never given.

interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}
interface DocField {
  key: string;
  value: string;
}
interface PeerCue {
  id: string;
  colour: string;
  name: string;
  cueId: string | null;
}
interface UndoHandler {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/** A stand-in for subedit's editor. The same one the pair tests use, kept in step. */
class StubEditor {
  cues: Cue[] = [];
  fields: DocField[] = [
    { key: "format", value: "srt" },
    { key: "eol", value: "\n" },
  ];
  fieldsReporter: ((f: DocField[]) => void) | null = null;
  peerCues: PeerCue[] = [];
  undoHandler: UndoHandler | null = null;
  selected: string | null = null;
  applied = 0;
  onChange: () => void = () => undefined;
  onSelectionChanged: (cueId: string | null) => void = () => undefined;

  cueSnapshot(): Cue[] {
    return this.cues.map((c) => ({ ...c }));
  }
  applyRemoteCues(cues: Cue[]): void {
    this.applied++;
    this.cues = cues.map((c) => ({ ...c }));
  }
  docFields(): DocField[] {
    return this.fields.map((f) => ({ ...f }));
  }
  setDocFieldsReporter(h: ((f: DocField[]) => void) | null): void {
    this.fieldsReporter = h;
  }
  applyRemoteDocFields(next: DocField[]): void {
    for (const item of next) {
      const found = this.fields.find((f) => f.key === item.key);
      if (found) found.value = item.value;
      else this.fields.push({ ...item });
    }
  }
  setPeerCues(peers: PeerCue[]): void {
    this.peerCues = peers;
  }
  setUndoHandler(h: UndoHandler | null): void {
    this.undoHandler = h;
  }
  selectedCueId(): string | null {
    return this.selected;
  }
  getText(): string {
    return this.cues.map((c) => c.text).join("\n");
  }
  focus(): void {}
  destroy(): void {}
  loadPreviewMedia(): void {}

  // --- what a person does ---

  type(id: string, text: string): void {
    const cue = this.cues.find((c) => c.id === id);
    if (cue) cue.text = text;
    this.onChange();
  }
  click(id: string | null): void {
    this.selected = id;
    this.onSelectionChanged(id);
  }
  setField(key: string, value: string): void {
    const found = this.fields.find((f) => f.key === key);
    if (found) found.value = value;
    else this.fields.push({ key, value });
    this.fieldsReporter?.(this.docFields());
    this.onChange();
  }
  field(key: string): string | undefined {
    return this.fields.find((f) => f.key === key)?.value;
  }
  text(id: string): string | undefined {
    return this.cues.find((c) => c.id === id)?.text;
  }
}

const built: StubEditor[] = [];

const FILE = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "First line.",
  "",
  "2",
  "00:00:04,000 --> 00:00:06,000",
  "Second line.",
  "",
  "3",
  "00:00:07,000 --> 00:00:09,000",
  "Third line.",
  "",
].join("\n");

/** Parse just enough of an SRT to give the stub cues with stable ids. */
function parse(text: string): Cue[] {
  const out: Cue[] = [];
  for (const chunk of text.trim().split(/\n\s*\n/)) {
    const lines = chunk.split("\n");
    if (lines.length < 3) continue;
    out.push({ id: `cue${lines[0].trim()}`, startMs: 0, endMs: 0, text: lines.slice(2).join("\n") });
  }
  return out;
}

vi.mock("subedit", () => ({
  createSubtitleEditor: (
    _el: unknown,
    input: { text: string },
    opts: { onChange?: () => void; onSelectionChanged?: (id: string | null) => void },
  ) => {
    const editor = new StubEditor();
    editor.cues = parse(input.text);
    editor.onChange = opts.onChange ?? (() => undefined);
    editor.onSelectionChanged = opts.onSelectionChanged ?? (() => undefined);
    built.push(editor);
    return editor;
  },
}));

async function baseDoc(text: string): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode(text);
  return { name: "subs.srt", bytes, hash: await hashBytes(bytes) };
}

interface Peer {
  session: CollabSession;
  editor: StubEditor;
  opened: BaseDoc[];
}

async function makePeer(opts: {
  text: string;
  name: string;
  colour: string;
  roomId: string;
  key?: CollabSession["key"];
}): Promise<Peer> {
  const { subtitleEditor } = await import("../../editors/subtitle.impl");
  const instance = subtitleEditor.create({} as never);
  const opened: BaseDoc[] = [];

  const mountCtx = {
    text: opts.text,
    bytes: null,
    binary: false,
    filename: "subs.srt",
    model: null,
    format: null,
    view: "text",
    onChange: () => undefined,
  } as unknown as EditorMountContext;
  instance.mount({} as HTMLElement, mountCtx);
  const editor = built[built.length - 1];

  const api: SessionHost = {
    currentDoc: async () => baseDoc(opts.text),
    localState: () => null,
    openBase: (d) => void opened.push(d),
    binding: () => instance.collab?.() ?? null,
    editorId: () => "subtitle",
    notify: () => undefined,
  };

  const session = new CollabSession(api, {
    name: opts.name,
    colour: opts.colour,
    key: opts.key,
    makeTransport: (key) => localTransport(key.roomId),
  });
  await session.start();
  return { session, editor, opened };
}

const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

let room = 0;
const nextRoom = (): string => `trio-${room++}-${Math.random().toString(36).slice(2)}`;

/** A host and two joiners, all bound and synced. */
async function trio(names: [string, string, string] = ["Ada", "Bo", "Cy"]): Promise<{
  a: Peer;
  b: Peer;
  c: Peer;
}> {
  const roomId = nextRoom();
  const a = await makePeer({ text: FILE, name: names[0], colour: "#f00", roomId });
  await settle();
  const b = await makePeer({ text: FILE, name: names[1], colour: "#0f0", roomId, key: a.session.key });
  await settle(250);
  // The third arrives after the first two have settled, which is the ordinary case and the
  // one that asks whether a two-peer session can become a three-peer one.
  const c = await makePeer({ text: FILE, name: names[2], colour: "#00f", roomId, key: a.session.key });
  await settle(300);
  return { a, b, c };
}

describe("three peers", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  it("carries one peer's edit to both of the others", async () => {
    const { a, b, c } = await trio();

    a.editor.type("cue2", "Edited by Ada.");
    await settle();

    expect(b.editor.text("cue2")).toBe("Edited by Ada.");
    expect(c.editor.text("cue2"), "the third peer is not an afterthought").toBe("Edited by Ada.");
  });

  it("carries a joiner's edit to the host and to the other joiner", async () => {
    const { a, b, c } = await trio();

    c.editor.type("cue1", "Edited by Cy.");
    await settle();

    expect(a.editor.text("cue1")).toBe("Edited by Cy.");
    expect(b.editor.text("cue1"), "and sideways, joiner to joiner").toBe("Edited by Cy.");
  });

  // Three people working at once, which is the case a pair test cannot pose at all.
  it("merges three edits made at the same moment in different places", async () => {
    const { a, b, c } = await trio();

    a.editor.type("cue1", "First, by Ada.");
    b.editor.type("cue2", "Second, by Bo.");
    c.editor.type("cue3", "Third, by Cy.");
    await settle(300);

    for (const peer of [a, b, c]) {
      expect(peer.editor.text("cue1")).toBe("First, by Ada.");
      expect(peer.editor.text("cue2")).toBe("Second, by Bo.");
      expect(peer.editor.text("cue3")).toBe("Third, by Cy.");
    }
  });

  it("gives the second joiner the document as it stands, not as it started", async () => {
    const roomId = nextRoom();
    const a = await makePeer({ text: FILE, name: "Ada", colour: "#f00", roomId });
    await settle();
    const b = await makePeer({ text: FILE, name: "Bo", colour: "#0f0", roomId, key: a.session.key });
    await settle(250);

    a.editor.type("cue1", "Changed before Cy arrived.");
    b.editor.type("cue2", "And so was this.");
    await settle(200);

    const c = await makePeer({ text: FILE, name: "Cy", colour: "#00f", roomId, key: a.session.key });
    await settle(300);

    expect(c.editor.text("cue1")).toBe("Changed before Cy arrived.");
    expect(c.editor.text("cue2"), "including the other joiner's work").toBe("And so was this.");
  });

  it("shows each peer the other two", async () => {
    const { a, b, c } = await trio();

    for (const peer of [a, b, c]) {
      expect(peer.session.peers(), "two others, not one").toHaveLength(2);
    }
    expect(a.session.peers().map((p) => p.name).sort()).toEqual(["Bo", "Cy"]);
    expect(c.session.peers().map((p) => p.name).sort()).toEqual(["Ada", "Bo"]);
  });

  // Names are deduplicated against the peers already present. With two arrivals that is a
  // single comparison; with three the second joiner must not land on the name the first
  // joiner moved to.
  it("gives three peers who all set no name three different ones", async () => {
    const { a, b, c } = await trio(["", "", ""]);

    const names = [a.session.myName, b.session.myName, c.session.myName];
    expect(new Set(names).size, `three distinct names, got ${names.join(", ")}`).toBe(3);
  });

  it("keeps the other two together when one leaves", async () => {
    const { a, b, c } = await trio();

    await c.session.leave();
    await settle(200);

    expect(a.session.peers().map((p) => p.name)).toEqual(["Bo"]);

    a.editor.type("cue1", "Still working.");
    await settle();
    expect(b.editor.text("cue1"), "the remaining pair carries on").toBe("Still working.");
  });

  it("carries a document field to both peers", async () => {
    const { a, b, c } = await trio();

    a.editor.setField("eol", "\r\n");
    await settle(200);

    expect(b.editor.field("eol")).toBe("\r\n");
    expect(c.editor.field("eol")).toBe("\r\n");
  });

  it("shows one peer's cue selection to both others", async () => {
    const { a, b, c } = await trio();

    a.editor.click("cue3");
    await settle(200);

    for (const peer of [b, c]) {
      const marks = peer.editor.peerCues.filter((p) => p.cueId === "cue3");
      expect(marks.map((m) => m.name), "Ada is where she says she is").toEqual(["Ada"]);
    }
  });
});


// The room outliving the person who opened it.
//
// A link-shared session has no server. If only the peer who started it can hand out the
// document, then their closing a tab makes the link useless to everyone who has not
// already used it, and it fails silently: the newcomer connects, sees the others, and sits
// with an empty document. The people already in notice nothing at all.
describe("three peers, after the one who started it leaves", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  it("still lets a newcomer in", async () => {
    const { a, b, c } = await trio();
    a.editor.type("cue1", "Written before Ada left.");
    await settle(200);

    await a.session.leave();
    await settle(200);

    const d = await makePeer({ text: "", name: "Di", colour: "#ff0", roomId: b.session.key.roomId, key: b.session.key });
    await settle(400);

    expect(d.opened.length, "someone handed over the file").toBe(1);
    expect(d.editor.text("cue1"), "and the work done since").toBe("Written before Ada left.");
    expect(c.editor.text("cue1"), "the others carry on regardless").toBe("Written before Ada left.");
  });

  it("hands the newcomer one copy, not one per peer", async () => {
    const { a, b } = await trio();
    await settle(200);

    const d = await makePeer({ text: "", name: "Di", colour: "#ff0", roomId: a.session.key.roomId, key: b.session.key });
    await settle(400);

    // Three peers hold the file and all three offer it. Taking each offer would download
    // the same document three times, on a link that may be someone's phone.
    expect(d.opened.length, "one transfer, whoever else offered").toBe(1);
  });
});
