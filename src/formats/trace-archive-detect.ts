import { Gunzip } from "fflate";
import { openArchiveStream, type ArchiveHandle } from "../core/archive-stream";
import { entryKind } from "./trace-kind";

// Whether an archive is a bundle of traces (Perfetto's zip and tar traces, a bug's worth of
// systrace and logcat): then it opens on one timeline instead of in the archive list.

const PEEK = 8 << 20;
const MAX_LOOK = 16;
const junk = (name: string): boolean => /(^|\/)(__MACOSX\/|\.(?!ninja_log$)[^/]*$)/.test(name);

/** The first `max` bytes of a gzip stream, decompressed. */
async function gunzipHead(blob: Blob, max: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const gz = new Gunzip((c) => {
    chunks.push(c);
    total += c.length;
  });
  const reader = blob.stream().getReader();
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      gz.push(value, false);
    }
  } catch {
    /* a damaged stream: what came out so far */
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Entries of a tar held in `tar` (a prefix may cut the last one off): names and bodies. */
function tarEntries(tar: Uint8Array): { name: string; data: Uint8Array; size: number }[] {
  const out: { name: string; data: Uint8Array; size: number }[] = [];
  const dec = new TextDecoder();
  const str = (o: number, n: number) => dec.decode(tar.subarray(o, o + n)).replace(/\0.*$/s, "");
  let p = 0;
  let long: string | null = null;
  while (p + 512 <= tar.length && tar[p] !== 0) {
    const size = parseInt(str(p + 124, 12).trim() || "0", 8) || 0;
    const type = tar[p + 156];
    const body = tar.subarray(p + 512, Math.min(tar.length, p + 512 + size));
    if (type === 0x4c) long = dec.decode(body).replace(/\0.*$/s, "");
    else if (type === 0 || type === 0x30) {
      const prefix = str(p + 345, 155);
      out.push({ name: long ?? (prefix ? `${prefix}/${str(p, 100)}` : str(p, 100)), data: body, size });
      long = null;
    } else long = null;
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** The share of the archive's files (by count or by size) that read as traces decides. */
function decide(found: { size: number; trace: boolean }[]): boolean {
  const traces = found.filter((f) => f.trace);
  if (!traces.length) return false;
  const total = found.reduce((n, f) => n + f.size, 0);
  const traced = traces.reduce((n, f) => n + f.size, 0);
  return traces.length * 2 >= found.length || traced >= total * 0.3;
}

export async function isTraceArchive(blob: Blob, filename = ""): Promise<boolean> {
  if (blob.size < 4) return false;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  try {
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (!/\.(?:tar\.gz|tgz)$/i.test(filename)) return false;
      // Only the start of a .tar.gz is unpacked to look: the viewer unpacks the whole.
      const entries = tarEntries(await gunzipHead(blob, PEEK)).filter((e) => !junk(e.name));
      return decide(entries.slice(0, MAX_LOOK).map((e) => ({ size: e.size, trace: !!entryKind(e.name, e.data, e.data.length >= e.size).kind })));
    }
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    const isTar = !isZip && blob.size > 262 && new TextDecoder().decode(await blob.slice(257, 262).arrayBuffer()) === "ustar";
    if (!isZip && !isTar) return false;
    const handle: ArchiveHandle | null = await openArchiveStream(blob, filename);
    if (!handle) return false;
    const files = handle.entries.filter((e) => !e.dir && !junk(e.name));
    if (!files.length || files.length > 2000) return false;
    const found: { size: number; trace: boolean }[] = [];
    for (const e of files.slice(0, MAX_LOOK)) {
      // An entry is read whole: very large ones count by their name alone.
      let trace = false;
      if (e.size <= PEEK) trace = !!entryKind(e.name, await handle.read(e.name)).kind;
      else trace = /\.(?:pftrace|perfetto-trace|perfetto|ctrace|fxt|systrace|atrace|ninja_log|strace|logcat)(?:\.gz)?$/i.test(e.name);
      found.push({ size: e.size, trace });
    }
    return decide(found);
  } catch {
    return false;
  }
}
