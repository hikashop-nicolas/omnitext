// Content detection shared by the JSON-family formats. A sample opening with "{" or "["
// is not enough: log lines open with a bracket too ("[    0.000000] Booting Linux",
// issue #43). What sets JSON apart is that nothing but whitespace follows the value the
// first bracket opens.

/** Offset just past the first top-level value in the sample, or -1 if the sample ends first. */
function firstValueEnd(s: string, quotes: string): number {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (quotes.includes(c)) quote = c;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return i + 1;
  }
  return -1;
}

/** True when the sample reads as one bracketed value: it opens with "{" or "[" and
 *  either runs past the end of the sample or is followed by whitespace only. */
export function isBracketedValue(sample: string, quotes = '"'): boolean {
  const s = sample.trimStart();
  if (!s.startsWith("{") && !s.startsWith("[")) return false;
  const end = firstValueEnd(s, quotes);
  return end === -1 || s.slice(end).trim() === "";
}
