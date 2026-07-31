import type { CellInput } from "./sheet-collab";

// Structural operations on a shared workbook: inserting and deleting rows and columns.
//
// These are the operations content-level merging cannot handle. Cells are shared by
// address, so inserting a row moves every address below it. Two peers doing that at once,
// or one doing it while the other types, produces addresses that mean different things on
// each side, and nothing in the data says so.
//
// The answer is not to merge them but to order them: one peer (the host) decides the
// sequence, everyone applies it in that order, and the shared cell map is rewritten once,
// by the host, as part of the same step. Content edits keep merging freely; only the
// structure is serialised, and only while a structural change is in flight.

export interface StructuralOp {
  kind: "insert" | "delete";
  axis: "row" | "col";
  sheet: string;
  /** 1-based index of the first row/column affected. */
  at: number;
  count: number;
}

/** An op as it travels, once the host has put it in order. */
export interface OrderedOp extends StructuralOp {
  /** Strictly increasing, assigned by the host. Peers apply in this order. */
  seq: number;
}

/**
 * Where a cell ends up after an operation, or null if the operation removed it.
 *
 * Deleting rows 2 to 3 does not move row 2's contents down or up: it removes them. Saying
 * so explicitly is what stops a delete from being read as a shift and quietly duplicating
 * the row above.
 */
export function shiftAddress(
  cell: { sheet: string; r: number; c: number },
  op: StructuralOp,
): { sheet: string; r: number; c: number } | null {
  if (cell.sheet !== op.sheet) return cell; // another sheet is untouched
  const pos = op.axis === "row" ? cell.r : cell.c;

  if (op.kind === "insert") {
    if (pos < op.at) return cell;
    return move(cell, op.axis, pos + op.count);
  }

  if (pos < op.at) return cell;
  if (pos < op.at + op.count) return null; // inside the deleted range
  return move(cell, op.axis, pos - op.count);
}

const move = (
  cell: { sheet: string; r: number; c: number },
  axis: "row" | "col",
  to: number,
): { sheet: string; r: number; c: number } =>
  axis === "row" ? { ...cell, r: to } : { ...cell, c: to };

/**
 * The whole cell set after an operation.
 *
 * Returned as a new list rather than applied in place, because the caller writes it into
 * the shared document in one transaction: a half-shifted map is a document nobody can read.
 */
export function shiftCells(cells: readonly CellInput[], op: StructuralOp): CellInput[] {
  const out: CellInput[] = [];
  for (const cell of cells) {
    const at = shiftAddress(cell, op);
    if (at) out.push({ ...at, input: cell.input });
  }
  return out;
}

/**
 * Applies ordered operations exactly once each, in sequence, holding back any that arrive
 * early.
 *
 * Out-of-order arrival is not a corner case here: the host broadcasts to every peer at
 * once, and a peer that is slow to receive one and quick to receive the next would
 * otherwise apply an insert against addresses that have not moved yet.
 */
export class OpSequencer {
  private next: number;
  private readonly held = new Map<number, OrderedOp>();

  constructor(private readonly apply: (op: OrderedOp) => void, startAt = 1) {
    this.next = startAt;
  }

  /** The sequence number this peer is waiting for. */
  get waitingFor(): number {
    return this.next;
  }

  /** How many ops arrived early and are still held back. */
  get pending(): number {
    return this.held.size;
  }

  receive(op: OrderedOp): void {
    if (op.seq < this.next) return; // already applied; a duplicate is not a second edit
    this.held.set(op.seq, op);
    while (this.held.has(this.next)) {
      const ready = this.held.get(this.next)!;
      this.held.delete(this.next);
      this.next += 1;
      this.apply(ready);
    }
  }
}

/** Hands out the sequence numbers. Only the host runs one. */
export class OpOrderer {
  private seq = 0;
  order(op: StructuralOp): OrderedOp {
    this.seq += 1;
    return { ...op, seq: this.seq };
  }
}
