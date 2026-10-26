import type * as Y from "yjs";
import type { EditCall } from "craftbridge/pdf";

// Sharing a PDF that the engine edits for real.
//
// The engine bakes each edit into the document, so there is no "file plus a set of edits" to
// merge as the older editor had. What peers share instead is the list of edits, in one order,
// and each one applies it to its own copy of the same starting file. The engine is
// deterministic, so the same edits in the same order give the same document everywhere.
//
// The order comes from a shared append-only log (a Y.Array). Two peers appending at the same
// moment is the normal case, and Yjs puts their entries in the same order for both once they
// meet. A peer that had already applied its own entry first then finds it is not where it
// thought: it takes back the engine's last steps until it reaches the point the two orders
// share, and applies the rest in the agreed order. Undo and redo are entries too, so one
// person's undo never touches another's work.
//
// An edit is addressed by position (the third object of page 2), not by a stable id, because
// the engine has none. That is exact when edits arrive in order and can point at a different
// object when two people change the same page at the same time; the same entries still make
// the same document everywhere, they just mean what the order says.

export const LOG = "pdfcraft.log";

/** An edit as it is stored: a picture travels as a hash and is fetched from the blob store. */
export type StoredCall = Exclude<EditCall, { op: "addImage" }> | { op: "addImage"; page: number; name: string; sha: string; view?: [number, number, number, number] };

export interface Entry {
  /** Unique, so the same entry is never taken for two. */
  id: string;
  /** Who wrote it: the author's Yjs client id. Undo and redo are per author. */
  by: number;
  kind: "op" | "undo" | "redo";
  op?: StoredCall;
}

/**
 * The edits in force, in log order, once every author's undo and redo are applied.
 *
 * An undo takes back its author's latest edit that is still in force; a redo puts back the latest
 * one that was taken back, until the author does something new, which ends the redo line. A redone
 * edit keeps its old place in the order rather than moving to the end, so everyone agrees where it is.
 */
export function inForce(entries: readonly Entry[]): Entry[] {
  const done = new Map<number, Entry[]>();
  const undone = new Map<number, Entry[]>();
  for (const e of entries) {
    const d = done.get(e.by) ?? [];
    const u = undone.get(e.by) ?? [];
    if (e.kind === "op") {
      d.push(e);
      u.length = 0;
    } else if (e.kind === "undo") {
      const last = d.pop();
      if (last) u.push(last);
    } else {
      const last = u.pop();
      if (last) d.push(last);
    }
    done.set(e.by, d);
    undone.set(e.by, u);
  }
  const live = new Set<string>();
  for (const list of done.values()) for (const e of list) live.add(e.id);
  return entries.filter((e) => e.kind === "op" && live.has(e.id));
}

export function canUndo(entries: readonly Entry[], me: number): boolean {
  return inForce(entries).some((e) => e.by === me);
}

export function canRedo(entries: readonly Entry[], me: number): boolean {
  let undone = 0;
  for (const e of entries) {
    if (e.by !== me) continue;
    if (e.kind === "op") undone = 0;
    else if (e.kind === "undo") undone++;
    else undone = Math.max(0, undone - 1);
  }
  return undone > 0 && entries.some((e) => e.by === me && e.kind === "op");
}

/** What the sequencer drives: the engine's copy of the document. */
export interface Machine {
  /** Applies one edit. Rejects when the engine refuses it (a stale index, say); it then has no step to undo. */
  apply(op: StoredCall): Promise<void>;
  /** Takes back the engine's last step. */
  undo(): Promise<void>;
}

/** What a sync did: how many steps it took back and how many entries it applied. */
export interface Change {
  undone: number;
  applied: number;
}

interface Applied {
  id: string;
  /** Whether the engine took it, so there is a step to take back. */
  effective: boolean;
}

/** Puts a machine into the state the log says, taking back and re-applying only what differs. */
export class Sequencer {
  private applied: Applied[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly machine: Machine,
    private readonly onChanged?: (change: Change) => void,
  ) {}

  /** The ids applied so far, in order. */
  get ids(): string[] {
    return this.applied.map((a) => a.id);
  }

  /** Brings the machine to exactly `want`. Calls are queued; the promise settles when this one is done. */
  sync(want: readonly Entry[]): Promise<void> {
    const run = async (): Promise<void> => {
      let keep = 0;
      while (keep < this.applied.length && keep < want.length && this.applied[keep]!.id === want[keep]!.id) keep++;
      let undone = 0;
      let applied = 0;
      for (const dropped of this.applied.splice(keep).reverse()) {
        if (dropped.effective) {
          undone++;
          await this.machine.undo();
        }
      }
      for (const entry of want.slice(keep)) {
        applied++;
        let effective = true;
        try {
          if (entry.op) await this.machine.apply(entry.op);
          else effective = false;
        } catch {
          effective = false;
        }
        this.applied.push({ id: entry.id, effective });
      }
      if (undone || applied) this.onChanged?.({ undone, applied });
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** The part of a Yjs document and its session the log needs. */
export interface LogContext {
  doc: Y.Doc;
  readOnly: boolean;
  blobs?: {
    put(bytes: Uint8Array): Promise<string>;
    get(sha: string): Uint8Array | undefined;
    fetch(sha: string): Promise<Uint8Array | null>;
  };
}

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** One peer's end of the shared log: records what this peer does, applies what everyone did. */
export class PdfLog {
  private readonly log: Y.Array<Entry>;
  private readonly origin = { pdfLog: true };
  private readonly sequencer: Sequencer;
  private readonly onChange = (): void => {
    void this.sequencer.sync(inForce(this.log.toArray()));
  };

  /** `engine` runs an edit with its picture bytes in place; `changed` tells the editor to read the document again. */
  constructor(
    private readonly ctx: LogContext,
    engine: { run(call: EditCall): Promise<void>; undo(): Promise<void> },
    changed: (change: Change) => void,
  ) {
    this.log = ctx.doc.getArray<Entry>(LOG);
    this.sequencer = new Sequencer(
      {
        apply: async (op) => {
          if (op.op !== "addImage") return engine.run(op);
          const bytes = this.ctx.blobs?.get(op.sha) ?? (await this.ctx.blobs?.fetch(op.sha)) ?? null;
          if (!bytes) throw new Error("the picture never arrived");
          const { sha: _sha, ...rest } = op;
          return engine.run({ ...rest, bytes });
        },
        undo: () => engine.undo(),
      },
      changed,
    );
  }

  get me(): number {
    return this.ctx.doc.clientID;
  }

  /** Starts applying the log, including what it already holds when this peer joins late. */
  start(): Promise<void> {
    this.log.observe(this.onChange);
    return this.sequencer.sync(inForce(this.log.toArray()));
  }

  stop(): void {
    this.log.unobserve(this.onChange);
  }

  private append(entry: Omit<Entry, "id" | "by">): Promise<void> {
    if (this.ctx.readOnly) return Promise.reject(new Error("this session is view-only"));
    const full: Entry = { id: newId(), by: this.me, ...entry };
    this.ctx.doc.transact(() => this.log.push([full]), this.origin);
    // the observer has queued the sync; waiting on a fresh one settles after it
    return this.sequencer.sync(inForce(this.log.toArray()));
  }

  /** Records an edit and resolves once it has been applied here (and, over time, everywhere). */
  async perform(call: EditCall): Promise<void> {
    if (call.op === "undo") return this.undo();
    if (call.op === "redo") return this.redo();
    let op: StoredCall;
    if (call.op === "addImage") {
      const sha = await this.ctx.blobs?.put(call.bytes);
      if (!sha) throw new Error("pictures cannot be shared in this session");
      const { bytes: _bytes, ...rest } = call;
      op = { ...rest, sha };
    } else op = call;
    await this.append({ kind: "op", op });
  }

  undo(): Promise<void> {
    return canUndo(this.log.toArray(), this.me) ? this.append({ kind: "undo" }) : Promise.resolve();
  }

  redo(): Promise<void> {
    return canRedo(this.log.toArray(), this.me) ? this.append({ kind: "redo" }) : Promise.resolve();
  }

  canUndo(): boolean {
    return canUndo(this.log.toArray(), this.me);
  }

  canRedo(): boolean {
    return canRedo(this.log.toArray(), this.me);
  }

  /** Resolves when every entry the log holds right now has been applied. */
  settled(): Promise<void> {
    return this.sequencer.sync(inForce(this.log.toArray()));
  }
}
