import { Gunzip } from "fflate";

// Binary CPU profiles recognised by content: pprof (protobuf, often gzipped) and simpleperf.

/** simpleperf report-sample --protobuf output starts with its name. */
export const looksLikeSimpleperf = (b: Uint8Array): boolean =>
  b.length >= 16 && String.fromCharCode(...b.subarray(0, 10)) === "SIMPLEPERF" && b[11] === 0;

function varint(b: Uint8Array, at: number): [number, number] | null {
  let v = 0;
  let mul = 1;
  for (let i = at; i < b.length && i < at + 10; i++) {
    v += (b[i]! & 0x7f) * mul;
    if (b[i]! < 0x80) return [v, i + 1];
    mul *= 128;
  }
  return null;
}

/** Whether b[s, e) holds only fields from `allowed` (field number to wire types). */
function fieldsOk(b: Uint8Array, s: number, e: number, allowed: Record<number, number[]>): boolean {
  let pos = s;
  while (pos < e) {
    const t = varint(b, pos);
    if (!t) return false;
    const f = Math.floor(t[0] / 8);
    const wt = t[0] % 8;
    if (!allowed[f]?.includes(wt)) return false;
    pos = t[1];
    if (wt === 0) {
      const v = varint(b, pos);
      if (!v) return false;
      pos = v[1];
    } else if (wt === 2) {
      const n = varint(b, pos);
      if (!n) return false;
      pos = n[1] + n[0];
    } else return false;
  }
  return pos === e;
}

// pprof's Profile: wire types of its fields, and of the messages it nests.
const PROFILE: Record<number, number[]> = { 1: [2], 2: [2], 3: [2], 4: [2], 5: [2], 6: [2], 7: [0], 8: [0], 9: [0], 10: [0], 11: [2], 12: [0], 13: [0, 2], 14: [0] };
const VALUE_TYPE: Record<number, number[]> = { 1: [0], 2: [0] };
const SAMPLE: Record<number, number[]> = { 1: [0, 2], 2: [0, 2], 3: [2] };

/**
 * A pprof Profile (ungzipped), from its first bytes: every whole top-level field in the head is
 * one the Profile message has, with at least one well-formed sample type and well-formed
 * samples. Perfetto traces, also protobuf, are checked before and repeat field 1 only.
 */
export function looksLikePprof(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  let pos = 0;
  let types = 0;
  let samples = 0;
  let others = 0;
  while (pos < b.length) {
    const t = varint(b, pos);
    if (!t) return false;
    const f = Math.floor(t[0] / 8);
    const wt = t[0] % 8;
    if (!PROFILE[f]?.includes(wt)) return false;
    pos = t[1];
    if (wt === 0) {
      const v = varint(b, pos);
      if (!v) break;
      pos = v[1];
      others++;
      continue;
    }
    const n = varint(b, pos);
    if (!n) break;
    const start = n[1];
    const end = start + n[0];
    if (end > b.length) break;
    if (f === 1) {
      if (!fieldsOk(b, start, end, VALUE_TYPE)) return false;
      types++;
    } else if (f === 2) {
      if (!fieldsOk(b, start, end, SAMPLE)) return false;
      samples++;
    } else others++;
    pos = end;
  }
  return types >= 1 && types <= 64 && samples + others >= 1;
}

/** The first bytes of a gzip stream, inflated: enough to recognise what it holds. */
export function gunzipHead(b: Uint8Array, want = 4096): Uint8Array | null {
  if (b[0] !== 0x1f || b[1] !== 0x8b) return null;
  const parts: Uint8Array[] = [];
  let have = 0;
  try {
    const g = new Gunzip((chunk) => {
      parts.push(chunk);
      have += chunk.length;
    });
    for (let at = 0; at < b.length && have < want; at += 16384) g.push(b.subarray(at, Math.min(b.length, at + 16384)), at + 16384 >= b.length);
  } catch {
    // A head cut off mid-stream still inflates its first part.
    if (!have) return null;
  }
  const out = new Uint8Array(Math.min(have, want));
  let at = 0;
  for (const p of parts) {
    if (at >= out.length) break;
    out.set(p.subarray(0, out.length - at), at);
    at += p.length;
  }
  return out;
}

/** The profile format id of these binary bytes (gzipped or not), or null. */
export function sniffProfileBytes(b: Uint8Array): string | null {
  const head = b[0] === 0x1f && b[1] === 0x8b ? gunzipHead(b) : b.subarray(0, 4096);
  if (!head) return null;
  if (looksLikeSimpleperf(head)) return "simpleperf";
  if (looksLikePprof(head)) return "pprof";
  return null;
}
