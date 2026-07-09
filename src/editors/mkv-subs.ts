// Minimal Matroska/WebM subtitle extractor. The <video> element ignores subtitle
// tracks embedded in the container, so we walk the EBML structure ourselves, collect
// the text-subtitle blocks (S_TEXT/UTF8 = SRT, S_TEXT/ASS|SSA, S_TEXT/WEBVTT) and
// rebuild each track as a standalone WebVTT file to attach via <track>. Bitmap
// subtitles (VobSub, PGS) have no text to extract and are skipped.

export interface MkvSubtitleTrack {
  label: string;
  language: string;
  vtt: string;
}

/** An audio track's identity, for the track-switch menu (playback swaps via remux). */
export interface MkvAudioTrack {
  /** Matroska TrackNumber; matches mediabunny's InputTrack.id. */
  number: number;
  label: string;
  language: string;
}

export interface MkvInfo {
  subtitles: MkvSubtitleTrack[];
  audio: MkvAudioTrack[];
}

// Element IDs (including their length-marker bits, as stored in the file).
const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMESTAMP_SCALE = 0x2ad7b1;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_NAME = 0x536e;
const ID_LANGUAGE = 0x22b59c;
const ID_LANGUAGE_BCP47 = 0x22b59d;
const ID_CLUSTER = 0x1f43b675;
const ID_CLUSTER_TIMESTAMP = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_BLOCK_DURATION = 0x9b;

// Segment-level children: an unknown-size Cluster ends when one of these appears.
const SEGMENT_CHILDREN = new Set([ID_INFO, ID_TRACKS, ID_CLUSTER, 0x114d9b74, 0x1c53bb6b, 0x1043a770, 0x1941a469, 0x1254c367]);

interface Cue {
  start: number; // ms
  end: number;
  text: string;
}

interface TrackInfo {
  codec: string;
  label: string;
  language: string;
  cues: Cue[];
}

class Reader {
  pos = 0;
  constructor(private b: Uint8Array) {}
  get length(): number {
    return this.b.length;
  }
  /** EBML element ID: length-marker bits kept, 1-4 bytes. */
  readId(): number {
    const first = this.b[this.pos]!;
    const len = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0;
    if (!len || this.pos + len > this.b.length) throw new Error("bad id");
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + this.b[this.pos + i]!;
    this.pos += len;
    return id;
  }
  /** EBML size: length-marker bits stripped; null = unknown size. */
  readSize(): number | null {
    const first = this.b[this.pos]!;
    let len = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) len++;
    if (len > 8 || this.pos + len > this.b.length) throw new Error("bad size");
    let v = first & (0xff >> len);
    let allOnes = v === 0xff >> len;
    for (let i = 1; i < len; i++) {
      const byte = this.b[this.pos + i]!;
      v = v * 256 + byte;
      if (byte !== 0xff) allOnes = false;
    }
    this.pos += len;
    return allOnes ? null : v;
  }
  uint(size: number): number {
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + this.b[this.pos + i]!;
    return v;
  }
  bytes(size: number): Uint8Array {
    return this.b.subarray(this.pos, this.pos + size);
  }
  peekId(): number | null {
    const save = this.pos;
    try {
      const id = this.readId();
      this.pos = save;
      return id;
    } catch {
      this.pos = save;
      return null;
    }
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: false });

/** ASS/SSA event line -> plain cue text (9th comma field onward, tags stripped). */
function assText(payload: string): string {
  const parts = payload.split(",");
  if (parts.length < 9) return payload;
  return parts
    .slice(8)
    .join(",")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/gi, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

/** WebVTT-in-Matroska block: "id\nsettings\ntext" per the mapping; keep the text part. */
function webvttText(payload: string): string {
  const lines = payload.split("\n");
  return (lines.length >= 3 ? lines.slice(2) : lines.slice(lines.length > 1 ? 1 : 0)).join("\n").trim();
}

function fmtTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = Math.floor(ms % 1000);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)}.${p(f, 3)}`;
}

function buildVtt(cues: Cue[]): string {
  const parts = ["WEBVTT"];
  for (const c of cues) {
    const text = c.text.replace(/-->/g, "→");
    if (!text) continue;
    parts.push(`${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${text}`);
  }
  return parts.join("\n\n") + "\n";
}

export function extractMkvSubtitles(bytes: Uint8Array): MkvSubtitleTrack[] {
  return extractMkvInfo(bytes).subtitles;
}

// --- external subtitle files (.srt / .ass / .ssa / .vtt) ----------------------

/**
 * Decode subtitle-file bytes to text. Subtitle files in the wild are often not
 * UTF-8 (Shift_JIS, GBK, EUC-KR, Windows-1252 are common); try strict decoders
 * in order and fall back to permissive Windows-1252, which never fails.
 */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  for (const enc of ["utf-8", "shift_jis", "euc-kr", "gb18030"]) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(bytes);
    } catch {
      /* next */
    }
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

/** SRT text -> WebVTT (comma decimals to dots, index lines dropped). */
export function srtToVtt(srt: string): string {
  const blocks = srt.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const out = ["WEBVTT"];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    if (/^\d+$/.test(lines[0]!.trim())) lines.shift(); // cue index
    if (!lines.length || !lines[0]!.includes("-->")) continue;
    const timing = lines[0]!.replace(/(\d+):(\d+):(\d+),(\d+)/g, "$1:$2:$3.$4");
    out.push(`${timing}\n${lines.slice(1).join("\n")}`);
  }
  return out.join("\n\n") + "\n";
}

/** ASS/SSA file -> WebVTT (Dialogue events; styling and positioning dropped). */
export function assFileToVtt(ass: string): string {
  const lines = ass.replace(/\r\n?/g, "\n").split("\n");
  let fields: string[] = [];
  const cues: Cue[] = [];
  const toMs = (t: string): number => {
    const m = t.trim().match(/(\d+):(\d+):(\d+)[.:](\d+)/);
    if (!m) return 0;
    return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]!.padEnd(3, "0").slice(0, 3));
  };
  for (const line of lines) {
    if (/^Format:/i.test(line)) {
      fields = line.slice(line.indexOf(":") + 1).split(",").map((f) => f.trim().toLowerCase());
    } else if (/^Dialogue:/i.test(line)) {
      const startIdx = fields.indexOf("start");
      const endIdx = fields.indexOf("end");
      const textIdx = fields.indexOf("text");
      if (startIdx < 0 || endIdx < 0 || textIdx < 0) continue;
      const parts = line.slice(line.indexOf(":") + 1).split(",");
      const text = parts
        .slice(textIdx)
        .join(",")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\N/gi, "\n")
        .replace(/\\h/g, " ")
        .trim();
      if (text) cues.push({ start: toMs(parts[startIdx]!), end: toMs(parts[endIdx]!), text });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  return buildVtt(cues);
}

/** Any supported subtitle file -> WebVTT, by extension (vtt passes through). */
export function subtitleFileToVtt(name: string, bytes: Uint8Array): string {
  const text = decodeSubtitleBytes(bytes);
  const lower = name.toLowerCase();
  if (lower.endsWith(".vtt")) return text.replace(/^﻿/, "");
  if (lower.endsWith(".ass") || lower.endsWith(".ssa")) return assFileToVtt(text);
  return srtToVtt(text);
}

export function extractMkvInfo(bytes: Uint8Array): MkvInfo {
  const empty: MkvInfo = { subtitles: [], audio: [] };
  if (bytes.length < 8 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return empty;
  const r = new Reader(bytes);
  const tracks = new Map<number, TrackInfo>();
  const audio: MkvAudioTrack[] = [];
  let scale = 1_000_000; // ns per tick (default = 1 ms)

  const parseBlock = (size: number, clusterTs: number, duration: number | null): void => {
    const start = r.pos;
    const trackNum = r.readSize(); // block track number is a plain EBML varint
    if (trackNum == null) throw new Error("bad block");
    const track = tracks.get(trackNum);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const relTime = view.getInt16(r.pos);
    const flags = bytes[r.pos + 2]!;
    r.pos += 3;
    const payloadLen = size - (r.pos - start);
    if (track && !(flags & 0x06) && payloadLen > 0) {
      const raw = utf8.decode(r.bytes(payloadLen)).replace(/\0+$/, "").replace(/\r\n/g, "\n");
      const text = track.codec.includes("ASS") || track.codec.includes("SSA") ? assText(raw) : track.codec.includes("WEBVTT") ? webvttText(raw) : raw.trim();
      const startMs = ((clusterTs + relTime) * scale) / 1e6;
      const durMs = duration != null ? (duration * scale) / 1e6 : 3000;
      if (text) track.cues.push({ start: Math.max(0, startMs), end: Math.max(0, startMs + durMs), text });
    }
    r.pos = start + size;
  };

  const parseTrackEntry = (end: number): void => {
    let num = 0;
    let type = 0;
    let codec = "";
    let name = "";
    let lang = "";
    while (r.pos < end) {
      const id = r.readId();
      const size = r.readSize();
      if (size == null) throw new Error("bad track entry");
      if (id === ID_TRACK_NUMBER) num = r.uint(size);
      else if (id === ID_TRACK_TYPE) type = r.uint(size);
      else if (id === ID_CODEC_ID) codec = utf8.decode(r.bytes(size)).replace(/\0+$/, "");
      else if (id === ID_NAME) name = utf8.decode(r.bytes(size));
      else if (id === ID_LANGUAGE || (id === ID_LANGUAGE_BCP47 && !lang)) lang = utf8.decode(r.bytes(size)).replace(/\0+$/, "");
      r.pos += size;
    }
    r.pos = end;
    if (type === 0x11 && codec.startsWith("S_TEXT")) tracks.set(num, { codec, label: name, language: lang || "und", cues: [] });
    else if (type === 0x02) audio.push({ number: num, label: name, language: lang || "und" });
  };

  const parseCluster = (end: number | null): void => {
    let clusterTs = 0;
    while (r.pos < (end ?? r.length)) {
      if (end == null) {
        const next = r.peekId();
        if (next == null || SEGMENT_CHILDREN.has(next)) return; // unknown-size cluster ended
      }
      const id = r.readId();
      const size = r.readSize();
      if (size == null) throw new Error("bad cluster child");
      if (id === ID_CLUSTER_TIMESTAMP) {
        clusterTs = r.uint(size);
        r.pos += size;
      } else if (id === ID_SIMPLE_BLOCK) {
        parseBlock(size, clusterTs, null);
      } else if (id === ID_BLOCK_GROUP) {
        const gEnd = r.pos + size;
        let blockAt = -1;
        let blockSize = 0;
        let duration: number | null = null;
        while (r.pos < gEnd) {
          const gid = r.readId();
          const gsize = r.readSize();
          if (gsize == null) throw new Error("bad block group");
          if (gid === ID_BLOCK) {
            blockAt = r.pos;
            blockSize = gsize;
          } else if (gid === ID_BLOCK_DURATION) duration = r.uint(gsize);
          r.pos += gsize;
        }
        if (blockAt >= 0) {
          const save = r.pos;
          r.pos = blockAt;
          parseBlock(blockSize, clusterTs, duration);
          r.pos = save;
        }
      } else {
        r.pos += size;
      }
    }
  };

  try {
    while (r.pos < r.length) {
      const id = r.readId();
      const size = r.readSize();
      if (id === ID_EBML) {
        if (size == null) return empty;
        r.pos += size;
      } else if (id === ID_SEGMENT) {
        const segEnd = size == null ? r.length : Math.min(r.pos + size, r.length);
        while (r.pos < segEnd) {
          const cid = r.readId();
          const csize = r.readSize();
          if (cid === ID_INFO && csize != null) {
            const iEnd = r.pos + csize;
            while (r.pos < iEnd) {
              const iid = r.readId();
              const isize = r.readSize();
              if (isize == null) throw new Error("bad info");
              if (iid === ID_TIMESTAMP_SCALE) scale = r.uint(isize);
              r.pos += isize;
            }
          } else if (cid === ID_TRACKS && csize != null) {
            const tEnd = r.pos + csize;
            while (r.pos < tEnd) {
              const tid = r.readId();
              const tsize = r.readSize();
              if (tsize == null) throw new Error("bad tracks");
              if (tid === ID_TRACK_ENTRY) parseTrackEntry(r.pos + tsize);
              else r.pos += tsize;
            }
          } else if (cid === ID_CLUSTER) {
            parseCluster(csize == null ? null : r.pos + csize);
          } else if (csize != null) {
            r.pos += csize;
          } else {
            return { subtitles: finish(tracks), audio }; // unknown-size non-cluster: bail with what we have
          }
        }
      } else if (size != null) {
        r.pos += size;
      } else {
        break;
      }
    }
  } catch {
    // Truncated or malformed tail: keep whatever cues were collected.
  }
  return { subtitles: finish(tracks), audio };
}

function finish(tracks: Map<number, TrackInfo>): MkvSubtitleTrack[] {
  const out: MkvSubtitleTrack[] = [];
  for (const t of tracks.values()) {
    if (!t.cues.length) continue;
    t.cues.sort((a, b) => a.start - b.start);
    out.push({ label: t.label || t.language, language: t.language, vtt: buildVtt(t.cues) });
  }
  return out;
}
