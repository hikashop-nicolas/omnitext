import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMountContext } from "../../core/types";
import { hashBytes, type BaseDoc } from "./base";
import { CollabSession, type SessionHost } from "./session";
import { localTransport } from "./local-transport";

// Holding newcomers at the door.
//
// What this is: the person who shared the link decides who gets the document. A link gets
// forwarded, and they are the only one who knows whether the fourth arrival was meant to
// be there.
//
// What it is not, and the tests say so where it matters: a security boundary. Anyone with
// the link is in the room, can see who else is there, and can be seen. The gate is on the
// document, not on the door to the building.
//
// The part that needs three peers to test at all: every peer applies the host's decision,
// not just the host. A gate only the host keeps is not a gate, because while the host is
// deciding, any other peer would hand the whole document over.

interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

class StubEditor {
  cues: Cue[] = [];
  fields: { key: string; value: string }[] = [{ key: "format", value: "srt" }];
  onChange: () => void = () => undefined;
  onSelectionChanged: (id: string | null) => void = () => undefined;
  selected: string | null = null;

  cueSnapshot(): Cue[] {
    return this.cues.map((c) => ({ ...c }));
  }
  applyRemoteCues(cues: Cue[]): void {
    this.cues = cues.map((c) => ({ ...c }));
  }
  docFields(): { key: string; value: string }[] {
    return this.fields.map((f) => ({ ...f }));
  }
  setDocFieldsReporter(): void {}
  applyRemoteDocFields(next: { key: string; value: string }[]): void {
    for (const f of next) {
      const found = this.fields.find((x) => x.key === f.key);
      if (found) found.value = f.value;
      else this.fields.push({ ...f });
    }
  }
  setPeerCues(): void {}
  setUndoHandler(): void {}
  selectedCueId(): string | null {
    return this.selected;
  }
  getText(): string {
    return this.cues.map((c) => c.text).join("\n");
  }
  focus(): void {}
  destroy(): void {}
  loadPreviewMedia(): void {}

  type(id: string, text: string): void {
    const cue = this.cues.find((c) => c.id === id);
    if (cue) cue.text = text;
    this.onChange();
  }
  text(id: string): string | undefined {
    return this.cues.find((c) => c.id === id)?.text;
  }
}

const built: StubEditor[] = [];

const FILE = ["1", "00:00:01,000 --> 00:00:03,000", "First line.", ""].join("\n");

vi.mock("subedit", () => ({
  createSubtitleEditor: (
    _el: unknown,
    input: { text: string },
    opts: { onChange?: () => void; onSelectionChanged?: (id: string | null) => void },
  ) => {
    const editor = new StubEditor();
    editor.cues = input.text.trim()
      ? [{ id: "cue1", startMs: 1000, endMs: 3000, text: "First line." }]
      : [];
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
  knocks: { name: string; peerId?: string }[][];
  /** A box rather than a number: a count copied at return time never changes again. */
  evicted: { count: number };
  /** What this peer was told about its own admission, in order. */
  waiting: string[];
}

async function makePeer(opts: {
  text: string;
  name: string;
  roomId: string;
  key?: CollabSession["key"];
  approveJoins?: boolean;
  /** Nothing open: no document to serve, and no editor to bind until the base arrives. */
  empty?: boolean;
}): Promise<Peer> {
  const { subtitleEditor } = await import("../../editors/subtitle.impl");
  const instance = subtitleEditor.create({} as never);
  const opened: BaseDoc[] = [];
  const knocks: { name: string; peerId?: string }[][] = [];
  const evicted = { count: 0 };
  const waiting: string[] = [];

  instance.mount({} as HTMLElement, {
    text: opts.text,
    bytes: null,
    binary: false,
    filename: "subs.srt",
    model: null,
    format: null,
    view: "text",
    onChange: () => undefined,
  } as unknown as EditorMountContext);
  const editor = built[built.length - 1];

  // What an empty workspace answers: nothing to serve, nothing to bind, nothing held.
  // The editor appears only when the base arrives, exactly as opening a file makes one.
  let hasDoc = !opts.empty;

  const api: SessionHost = {
    currentDoc: async () => (hasDoc ? baseDoc(opts.text) : null),
    localState: () => null,
    openBase: (d) => {
      opened.push(d);
      hasDoc = true;
    },
    binding: () => (hasDoc ? (instance.collab?.() ?? null) : null),
    editorId: () => "subtitle",
    notify: () => undefined,
    onKnock: (waiting) => void knocks.push(waiting.map((w) => ({ name: w.name, peerId: w.peerId }))),
    onEvicted: () => void (evicted.count += 1),
    onWaiting: (what) => void waiting.push(what),
  };

  const session = new CollabSession(api, {
    name: opts.name,
    colour: "#f00",
    key: opts.key,
    approveJoins: opts.approveJoins,
    makeTransport: (key) => localTransport(key.roomId),
  });
  await session.start();
  return { session, editor, opened, knocks, evicted, waiting };
}

const settle = (ms = 200): Promise<void> => new Promise((r) => setTimeout(r, ms));

let room = 0;
const nextRoom = (): string => `door-${room++}-${Math.random().toString(36).slice(2)}`;

describe("holding newcomers at the door", () => {
  beforeEach(() => void (built.length = 0));
  afterEach(() => void built.splice(0));

  it("gives a newcomer nothing until they are let in", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);

    expect(guest.opened, "no document").toHaveLength(0);
    expect(guest.editor.cues, "and nothing through the CRDT either").toHaveLength(0);
  });

  it("tells the host who is waiting, by name", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);

    expect(host.session.waiting().map((p) => p.name)).toEqual(["Bo"]);
    expect(host.knocks.length, "and said so as it happened").toBeGreaterThan(0);
  });

  // The gate is on the document, not on the room. Saying otherwise in the UI would be a
  // promise this cannot keep, so the test pins what actually holds.
  it("does not hide the room from someone waiting", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);

    expect(guest.session.peers().map((p) => p.name), "they can see who is here").toEqual(["Ada"]);
  });

  it("hands over the document the moment they are let in", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);

    host.session.admit(host.session.waiting()[0]?.peerId ?? "");
    await settle(400);

    expect(guest.opened, "the file").toHaveLength(1);
    expect(guest.editor.text("cue1"), "and its contents").toBe("First line.");
    expect(host.session.waiting(), "nobody left at the door").toHaveLength(0);
  });

  it("carries edits both ways once someone is in", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);
    host.session.admit(host.session.waiting()[0]?.peerId ?? "");
    await settle(400);

    host.editor.type("cue1", "Ada writes.");
    await settle(250);
    expect(guest.editor.text("cue1")).toBe("Ada writes.");

    guest.editor.type("cue1", "Bo writes.");
    await settle(250);
    expect(host.editor.text("cue1")).toBe("Bo writes.");
  });

  it("tells someone who is turned away, and closes their copy", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);

    host.session.refuse(host.session.waiting()[0]?.peerId ?? "");
    await settle(300);

    expect(guest.evicted.count, "told, not left wondering").toBe(1);
    expect(guest.opened, "and still nothing").toHaveLength(0);
  });

  // The reason this needs three peers. While the host is deciding about Cy, Bo is already
  // in and holds the whole document.
  it("stops an admitted peer handing the document to someone still waiting", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const bo = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);
    host.session.admit(host.session.waiting()[0]?.peerId ?? "");
    await settle(400);
    expect(bo.opened, "Bo is in").toHaveLength(1);

    const cy = await makePeer({ text: "", name: "Cy", roomId, key: host.session.key });
    await settle(400);

    expect(cy.opened, "and Bo did not let Cy in").toHaveLength(0);
    expect(cy.editor.cues).toHaveLength(0);
  });

  it("lets a peer in through the others once the host says so", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const bo = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);
    host.session.admit(host.session.waiting()[0]?.peerId ?? "");
    await settle(400);

    const cy = await makePeer({ text: "", name: "Cy", roomId, key: host.session.key });
    await settle(400);
    const waiting = host.session.waiting().find((p) => p.name === "Cy");
    host.session.admit(waiting?.peerId ?? "");
    await settle(450);

    expect(cy.opened, "in").toHaveLength(1);
    bo.editor.type("cue1", "Bo writes to everyone.");
    await settle(300);
    expect(cy.editor.text("cue1"), "and part of the session, not just the host's").toBe(
      "Bo writes to everyone.",
    );
  });

  it("lets everyone waiting in when the door is turned off", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const bo = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);
    expect(bo.opened).toHaveLength(0);

    host.session.setApproveJoins(false);
    await settle(400);

    expect(bo.opened, "no longer waiting on anyone").toHaveLength(1);
  });

  it("is off unless it was asked for", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);

    expect(host.session.gatekeeping).toBe(false);
    expect(guest.opened, "the ordinary session is unchanged").toHaveLength(1);
  });

  // A joiner cannot hold the door: it has no standing to, and pretending otherwise would
  // give two people different ideas about who is in.
  it("gives a joiner no door to hold", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key, approveJoins: true });
    await settle(350);

    expect(guest.session.gatekeeping).toBe(false);
    expect(guest.session.waiting()).toEqual([]);
  });


  // Turning the door on partway through a session. Found in a browser, not here: the
  // people already in the room hold the document and are working in it, and putting them
  // back outside stopped their edits reaching anyone until the host approved people who
  // were already inside.
  it("does not put the people already here back outside", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId });
    await settle();
    const bo = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);
    expect(bo.opened, "Bo is in before the door exists").toHaveLength(1);

    host.session.setApproveJoins(true);
    await settle(200);

    expect(host.session.waiting(), "nobody is asked to knock twice").toHaveLength(0);

    host.editor.type("cue1", "Still reaching Bo.");
    await settle(300);
    expect(bo.editor.text("cue1"), "and the session carries on").toBe("Still reaching Bo.");
  });

  it("still holds someone who arrives after the door goes up", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId });
    await settle();
    const bo = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key });
    await settle(350);

    host.session.setApproveJoins(true);
    await settle(200);

    const cy = await makePeer({ text: "", name: "Cy", roomId, key: host.session.key });
    await settle(400);

    expect(cy.opened, "the newcomer waits").toHaveLength(0);
    expect(host.session.waiting().map((p) => p.name)).toEqual(["Cy"]);
    expect(bo.opened, "and Bo is untouched by it").toHaveLength(1);
  });

  // Following a link on a browser with nothing open, which is the person opening Omnitext
  // for the first time because a colleague sent them a link. Requiring them to have a
  // document already is backwards: the session exists to give them the host's.
  it("lets someone with nothing open join and receive the document", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId });
    await settle();

    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key, empty: true });
    await settle(400);

    expect(guest.opened, "the file arrived").toHaveLength(1);
    expect(guest.editor.text("cue1"), "with its contents").toBe("First line.");
  });

  it("carries later edits to a peer that arrived with nothing", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key, empty: true });
    await settle(400);

    host.editor.type("cue1", "Written after Bo arrived.");
    await settle(300);

    expect(guest.editor.text("cue1")).toBe("Written after Bo arrived.");
  });

  // The door still comes first. Someone arriving with nothing open must not be handed the
  // document before the host says so, and being empty must not be a way around the gate.
  it("gives an empty newcomer nothing until they are let in", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();

    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key, empty: true });
    await settle(400);

    expect(guest.opened, "not before the host agrees").toHaveLength(0);
    expect(host.session.waiting().map((p) => p.name)).toEqual(["Bo"]);

    host.session.admit(host.session.waiting()[0]?.peerId ?? "");
    await settle(450);

    expect(guest.opened, "and now it comes").toHaveLength(1);
    expect(guest.editor.text("cue1")).toBe("First line.");
  });

  it("tells an empty newcomer that they are waiting", async () => {
    const roomId = nextRoom();
    const host = await makePeer({ text: FILE, name: "Ada", roomId, approveJoins: true });
    await settle();
    const guest = await makePeer({ text: "", name: "Bo", roomId, key: host.session.key, empty: true });
    await settle(400);

    // Nothing on screen and no reason given is the failure this replaced.
    expect(guest.waiting, "said so").toContain("waiting");
  });
});
