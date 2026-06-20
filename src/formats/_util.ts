// Convert a 1-based line/column (as parser errors report) to a text offset, so
// diagnostics can point at a position. Approximate: treats any newline as 1 char.
export function lineColToOffset(text: string, line: number, col: number): number {
  const lines = text.split(/\r\n|\r|\n/);
  let off = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    off += (lines[i]?.length ?? 0) + 1;
  }
  return off + Math.max(0, col - 1);
}
