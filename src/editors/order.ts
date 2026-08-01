import type * as Y from "yjs";

// Keeping a shared list of ids in the order a peer wants, without rewriting it.
//
// Replacing the array wholesale (delete everything, insert the new order) looks equivalent
// and merges wrongly: two peers who each append their own id both delete the shared prefix
// and re-insert it, so the result holds it twice. Writing only the delete and the insert
// that actually explain the difference leaves each peer's change small enough to merge.

/** Rewrite `order` as the smallest delete and insert that turns `prev` into `next`. */
export function spliceIds(order: Y.Array<string>, prev: readonly string[], next: readonly string[]): void {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  if (endPrev > start) order.delete(start, endPrev - start);
  if (endNext > start) order.insert(start, next.slice(start, endNext));
}
