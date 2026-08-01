import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMountContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
import { localTransport } from "./local-transport";

// Two whole peers, over the real same-browser transport, with the real editor binding.
//
// Everything below this line already has tests: the shared cue shape is tested with two
// Y.Docs, the session with a fake network and a fake editor, the transport on its own. What
// none of them covers is the piece that joins them, subtitle.impl.ts, and that is where
// every Phase 1 bug actually was: a joiner that never bound, a base that arrived before the
// editor existed, presence published without a name. Each of those left the parts passing
// and the product broken.
//
// So this assembles the real thing and leaves out only the editor widget, which needs a
// browser and is subedit's own business anyway. What stays real: the session, the base
// transfer, the CRDT, presence, the undo scoping, and BroadcastChannel underneath.

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

/**
 * A stand-in for subedit's editor: holds cues, reports changes, records what it was shown.
 *
 * It is a stand-in for the widget only. Every line of the binding that talks to it is the
 * real one, which is the whole point: the stub is the screen, not the logic.
 */
class StubEditor {
  cues: Cue[] = [];
  /**
   * Everything the file is beside its cues, keyed. The values here are the ones subedit
   * reports for an ASS file, because ASS is where this matters: a style table is a list of
   * independent definitions two people can edit at once.
   */
  fields: DocField[] = [
    { key: "format", value: "ass" },
    { key: "eol", value: "\n" },
    { key: "assScriptInfo", value: "[Script Info]\nTitle: Untitled\n" },
    { key: "style:Default", value: JSON.stringify({ name: "Default", Fontsize: "36" }) },
    { key: "style:Title", value: JSON.stringify({ name: "Title", Fontsize: "60" }) },
  ];
  fieldsReporter: ((f: DocField[]) => void) | null = null;
  /** How many times a peer's fields were put on screen, to catch one echoing round. */
  fieldsApplied = 0;
  peerCues: PeerCue[] = [];
  undoHandler: UndoHandler | null = null;
  selected: string | null = null;
  /** How many times a remote change was put on screen, to catch an edit echoing round. */
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
    this.fieldsApplied++;
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

  /** Edit a cue the way typing does: change it, then tell the host. */
  type(id: string, text: string): void {
    const cue = this.cues.find((c) => c.id === id);
    if (cue) cue.text = text;
    this.onChange();
  }
  /** Move a cue in time, the way dragging it on the waveform does. */
  retime(id: string, startMs: number, endMs: number): void {
    const cue = this.cues.find((c) => c.id === id);
    if (cue) {
      cue.startMs = startMs;
      cue.endMs = endMs;
    }
    this.onChange();
  }
  /** Click a cue. */
  click(id: string | null): void {
    this.selected = id;
    this.onSelectionChanged(id);
  }
  /** Change a document field, the way editing the style table or the script info does. */
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
}

/** Every editor built during a test, in creation order, so a test can drive them. */
const built: StubEditor[] = [];

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

/**
 * Cue ids are stable across a re-parse here, deliberately.
 *
 * subedit generates them per parse, so two peers reading the same file agree on the words
 * and on none of the ids. That is real, and a real session never hits it: the joiner adopts
 * the seeder's cues rather than parsing its own copy. Reproducing it here would test the
 * session against a situation the session prevents, so the ids come from the position.
 */
function parse(text: string): Cue[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, i) => ({ id: `cue${i + 1}`, startMs: i * 1000, endMs: i * 1000 + 900, text: line }));
}

const FILE = "First line.\nSecond line.\nThird line.";

async function baseDoc(text: string): Promise<BaseDoc> {
  const bytes = new TextEncoder().encode(text);
  return { name: "subs.srt", bytes, hash: await hashBytes(bytes) };
}

/** One peer: a real editor instance, a real binding, a real session. */
interface Peer {
  session: CollabSession;
  editor: StubEditor;
  notes: string[];
  opened: BaseDoc[];
}

async function makePeer(opts: {
  text: string;
  name: string;
  colour: string;
  roomId: string;
  key?: CollabSession["key"];
  /** What this peer holds already, so a joiner can refuse or skip the transfer. */
  localState?: () => { hash: string; dirty: boolean } | null;
  readOnly?: boolean;
}): Promise<Peer> {
  const { subtitleEditor } = await import("../../editors/subtitle.impl");
  const instance = subtitleEditor.create({} as never);
  const notes: string[] = [];
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
    localState: opts.localState ?? (() => null),
    openBase: (d) => void opened.push(d),
    binding: () => instance.collab?.() ?? null,
    editorId: () => "subtitle",
    notify: (m) => notes.push(m),
  };

  const session = new CollabSession(api, {
    name: opts.name,
    colour: opts.colour,
    key: opts.key,
    readOnly: opts.readOnly,
    makeTransport: (key) => localTransport(key.roomId),
  });
  await session.start();
  return { session, editor, notes, opened };
}

/**
 * Let the two finish talking.
 *
 * BroadcastChannel delivers on a real macrotask and the handshake is a chain of awaits over
 * a real SHA-256, so this waits on the clock rather than draining microtasks. Generous
 * enough not to be timing-sensitive, small enough that a whole file of these is quick.
 */
const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

let room = 0;
const nextRoom = (): string => `pair-${room++}-${Math.random().toString(36).slice(2)}`;

/** Host and joiner on the same file, bound and synced. The common opening. */
async function connected(readOnlyJoiner = false): Promise<{ a: Peer; b: Peer }> {
  const roomId = nextRoom();
  const a = await makePeer({ text: FILE, name: "Ada", colour: "#f00", roomId });
  await settle();
  const b = await makePeer({
    text: FILE,
    name: "Bo",
    colour: "#00f",
    roomId,
    key: a.session.key,
    readOnly: readOnlyJoiner,
  });
  await settle(250);
  return { a, b };
}

describe("two peers, real transport, real binding", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  it("carries an edit from one peer's editor to the other's", async () => {
    const { a, b } = await connected();

    a.editor.type("cue2", "Edited by Ada.");
    await settle();

    expect(b.editor.cues.map((c) => c.text)).toEqual(["First line.", "Edited by Ada.", "Third line."]);
    expect(a.editor.cues[1].text).toBe("Edited by Ada.");
  });

  // The echo. A remote change puts cues on screen, and the binding then has the chance to
  // publish what it just received. What has to hold is the property, not any one guard:
  // nothing goes back out. (Two things enforce it, an applyingRemote flag and writeCues
  // writing only what differs. Removing the flag alone does not fail this test, which is
  // the honest position: the flag saves a diff, the diff is what saves the session.)
  it("does not publish a change that came from the other peer", async () => {
    const { a, b } = await connected();

    const before = a.editor.applied;
    a.editor.type("cue1", "Once.");
    await settle();
    expect(b.editor.cues[0].text).toBe("Once.");

    // B put it on screen once. If B had republished it, A would have applied it back.
    await settle();
    expect(a.editor.applied, "the edit did not come back").toBe(before);
  });

  it("merges edits each peer makes to a different cue", async () => {
    const { a, b } = await connected();

    a.editor.type("cue1", "Ada was here.");
    b.editor.type("cue3", "Bo was here.");
    await settle(200);

    const expected = ["Ada was here.", "Second line.", "Bo was here."];
    expect(a.editor.cues.map((c) => c.text), "A has both").toEqual(expected);
    expect(b.editor.cues.map((c) => c.text), "and so does B").toEqual(expected);
  });

  it("shows each peer where the other is, by name and colour", async () => {
    const { a, b } = await connected();

    a.editor.click("cue3");
    await settle();

    expect(b.editor.peerCues).toHaveLength(1);
    expect(b.editor.peerCues[0]).toMatchObject({ name: "Ada", colour: "#f00", cueId: "cue3" });
    // And the marker follows them rather than piling up.
    a.editor.click("cue1");
    await settle();
    expect(b.editor.peerCues).toHaveLength(1);
    expect(b.editor.peerCues[0].cueId).toBe("cue1");
  });

  // Undo has to be scoped to what this peer did. subedit's own undo restores a whole-model
  // snapshot, so leaving it in charge would silently take back the other peer's work.
  it("undoes only the peer's own edit, leaving the other's alone", async () => {
    const { a, b } = await connected();

    b.editor.type("cue1", "Bo typed this.");
    await settle();
    a.editor.type("cue3", "Ada typed this.");
    await settle();

    expect(b.editor.undoHandler, "the session took undo over").not.toBeNull();
    b.editor.undoHandler?.undo();
    await settle();

    expect(b.editor.cues[0].text, "B's own edit is taken back").toBe("First line.");
    expect(b.editor.cues[2].text, "A's edit survives it").toBe("Ada typed this.");
    expect(a.editor.cues[0].text, "and A sees the same").toBe("First line.");
  });

  it("gives undo back to the editor when the session ends", async () => {
    const { b } = await connected();
    expect(b.editor.undoHandler).not.toBeNull();

    await b.session.leave();
    await settle();

    expect(b.editor.undoHandler, "its own undo again").toBeNull();
    expect(b.editor.peerCues, "and nobody is here any more").toEqual([]);
  });

  // A joiner must take the session's document, not seed its own. Seeding from both sides
  // was the bug that doubled the file.
  it("adopts the session's cues rather than seeding its own", async () => {
    const roomId = nextRoom();
    const a = await makePeer({ text: FILE, name: "Ada", colour: "#f00", roomId });
    await settle();
    a.editor.type("cue1", "Changed before Bo arrived.");
    await settle();

    const b = await makePeer({
      text: "Something else entirely.",
      name: "Bo",
      colour: "#00f",
      roomId,
      key: a.session.key,
    });
    await settle(250);

    expect(b.editor.cues.map((c) => c.text)).toEqual([
      "Changed before Bo arrived.",
      "Second line.",
      "Third line.",
    ]);
    expect(a.editor.cues, "and the host's document is not doubled").toHaveLength(3);
  });

  it("mirrors edits into a view-only peer and publishes none back", async () => {
    const roomId = nextRoom();
    const a = await makePeer({ text: FILE, name: "Ada", colour: "#f00", roomId });
    await settle();
    const b = await makePeer({
      text: FILE,
      name: "Bo",
      colour: "#00f",
      roomId,
      key: a.session.key,
      readOnly: true,
    });
    await settle(250);

    a.editor.type("cue2", "Ada can write.");
    await settle();
    expect(b.editor.cues[1].text, "a watcher still sees the work").toBe("Ada can write.");

    b.editor.type("cue3", "Bo cannot.");
    await settle();
    expect(a.editor.cues[2].text, "and cannot change it").toBe("Third line.");
  });
});

// Everything the file is beside its cues. Two peers agreeing on every line of dialogue
// while disagreeing on the style table, the script info, or the line endings is a real way
// to lose work, and neither editor can see it happening on its own.
describe("two peers, the document beside its cues", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  it("carries a document field from one peer to the other", async () => {
    const { a, b } = await connected();

    a.editor.setField("assScriptInfo", "[Script Info]\nTitle: Ada's cut\n");
    await settle();

    expect(b.editor.field("assScriptInfo")).toContain("Ada's cut");
  });

  // The reason fields are keyed rather than sent as one blob. Both peers change the style
  // table at once in different rows; a whole-table exchange would hand the table to
  // whoever spoke last, and the other would find their work gone.
  it("merges two peers restyling different styles at the same moment", async () => {
    const { a, b } = await connected();

    a.editor.setField("style:Default", JSON.stringify({ name: "Default", Fontsize: "48" }));
    b.editor.setField("style:Title", JSON.stringify({ name: "Title", Fontsize: "80" }));
    await settle(200);

    for (const peer of [a, b]) {
      expect(peer.editor.field("style:Default"), "Ada's restyle survives").toContain("48");
      expect(peer.editor.field("style:Title"), "and so does Bo's").toContain("80");
    }
  });

  it("does not send a peer's field back to them", async () => {
    const { a, b } = await connected();
    const before = a.editor.fieldsApplied;

    a.editor.setField("eol", "\r\n");
    await settle(200);

    expect(b.editor.field("eol")).toBe("\r\n");
    expect(a.editor.fieldsApplied, "the change did not come back").toBe(before);
  });

  it("gives a joiner the seeder's fields, not its own", async () => {
    const roomId = nextRoom();
    const a = await makePeer({ text: FILE, name: "Ada", colour: "#f00", roomId });
    a.editor.setField("style:Default", JSON.stringify({ name: "Default", Fontsize: "22" }));
    await settle();

    const b = await makePeer({ text: FILE, name: "Bo", colour: "#00f", roomId, key: a.session.key });
    await settle(250);

    expect(b.editor.field("style:Default")).toContain("22");
  });

  // subedit has no read-only mode of its own, so the binding is the only thing standing
  // between a watcher and everyone else's style table.
  it("keeps a view-only peer's fields to themselves", async () => {
    const { a, b } = await connected(true);

    b.editor.setField("assScriptInfo", "[Script Info]\nTitle: Bo was here\n");
    await settle(200);

    expect(a.editor.field("assScriptInfo"), "a watcher writes nothing").not.toContain(
      "Bo was here",
    );
  });

  it("carries cues and fields in the same session", async () => {
    const { a, b } = await connected();

    a.editor.type("cue2", "Second cue, edited by Ada.");
    b.editor.setField("fps", "23.976");
    await settle(200);

    expect(b.editor.cues.find((c) => c.id === "cue2")?.text).toBe("Second cue, edited by Ada.");
    expect(a.editor.field("fps")).toBe("23.976");
  });
});


// Two people inside one cue.
//
// Not the same shape of problem as two people in one paragraph. A cue is one line of
// dialogue and the two numbers saying when it is on screen, and the realistic collision is
// not two typists: it is one person retiming a track while another proofreads it. Holding
// the cue as a single value makes those two an unresolvable conflict over work that does
// not overlap at all.
describe("two peers inside one cue", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  it("keeps a retiming and a rewording of the same cue", async () => {
    const { a, b } = await connected();

    a.editor.retime("cue2", 5000, 7000);
    b.editor.type("cue2", "Second line, proofread.");
    await settle(250);

    for (const peer of [a, b]) {
      const cue = peer.editor.cues.find((c) => c.id === "cue2");
      expect(cue?.startMs, "Ada's retiming").toBe(5000);
      expect(cue?.text, "and Bo's wording").toBe("Second line, proofread.");
    }
  });

  it("merges two edits at different ends of one line", async () => {
    const { a, b } = await connected();

    a.editor.type("cue1", "Well, First line.");
    b.editor.type("cue1", "First line, indeed.");
    await settle(250);

    const text = a.editor.cues.find((c) => c.id === "cue1")?.text ?? "";
    expect(text).toContain("Well,");
    expect(text).toContain("indeed.");
    expect(b.editor.cues.find((c) => c.id === "cue1")?.text, "and both agree").toBe(text);
  });

  it("does not resurrect a deleted word because the other peer typed elsewhere", async () => {
    const { a, b } = await connected();
    a.editor.type("cue3", "One two three.");
    await settle(200);

    a.editor.type("cue3", "One three.");
    b.editor.type("cue3", "One two three. Four.");
    await settle(250);

    for (const peer of [a, b]) {
      const text = peer.editor.cues.find((c) => c.id === "cue3")?.text ?? "";
      expect(text, "the cut stays cut").not.toContain("two");
      expect(text, "and the addition stays").toContain("Four.");
    }
  });
});
