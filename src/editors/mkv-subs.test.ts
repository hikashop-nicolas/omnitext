import { describe, expect, it } from "vitest";
import { assFileToVtt, decodeSubtitleBytes, extractMkvInfo, extractMkvSubtitles, srtToVtt } from "./mkv-subs";

// Hand-built EBML fixtures: enough Matroska structure for the extractor
// (EBML header, Segment > Info/Tracks/Cluster with subtitle blocks).

const te = new TextEncoder();

function vintSize(n: number): number[] {
  // Encode a size in the fewest bytes (1-4 covers the fixtures).
  if (n < 0x7f) return [0x80 | n];
  if (n < 0x3fff) return [0x40 | (n >> 8), n & 0xff];
  if (n < 0x1fffff) return [0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff];
  return [0x10 | (n >> 24), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function idBytes(id: number): number[] {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return out;
}

function el(id: number, payload: number[] | Uint8Array): number[] {
  const p = Array.from(payload);
  return [...idBytes(id), ...vintSize(p.length), ...p];
}

function uintPayload(n: number): number[] {
  const out: number[] = [];
  let v = n;
  do {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return out;
}

/** SimpleBlock payload: track varint, relTime int16, flags, data. */
function simpleBlock(track: number, relTime: number, text: string): number[] {
  const rt = relTime < 0 ? relTime + 0x10000 : relTime;
  return [0x80 | track, (rt >> 8) & 0xff, rt & 0xff, 0, ...te.encode(text)];
}

function subtitleTrackEntry(num: number, codec: string, name?: string, lang?: string): number[] {
  const kids = [
    ...el(0xd7, uintPayload(num)), // TrackNumber
    ...el(0x83, [0x11]), // TrackType subtitle
    ...el(0x86, Array.from(te.encode(codec))), // CodecID
    ...(name ? el(0x536e, Array.from(te.encode(name))) : []),
    ...(lang ? el(0x22b59c, Array.from(te.encode(lang))) : []),
  ];
  return el(0xae, kids);
}

function mkv(opts: { tracks: number[]; clusters: number[] }): Uint8Array {
  const segment = el(0x18538067, [
    ...el(0x1549a966, el(0x2ad7b1, uintPayload(1_000_000))), // Info > TimestampScale 1ms
    ...el(0x1654ae6b, opts.tracks),
    ...opts.clusters,
  ]);
  return new Uint8Array([...el(0x1a45dfa3, []), ...segment]);
}

describe("mkv subtitle extraction", () => {
  it("extracts SRT-style cues with BlockGroup durations", () => {
    const cluster = el(0x1f43b675, [
      ...el(0xe7, uintPayload(10000)), // cluster at 10s
      ...el(0xa0, [
        ...el(0xa1, simpleBlock(1, 500, "Hello <i>world</i>")),
        ...el(0x9b, uintPayload(2000)),
      ]),
      ...el(0xa0, [...el(0xa1, simpleBlock(1, 4000, "Second line")), ...el(0x9b, uintPayload(1500))]),
    ]);
    const subs = extractMkvSubtitles(mkv({ tracks: subtitleTrackEntry(1, "S_TEXT/UTF8", "English", "eng"), clusters: cluster }));
    expect(subs).toHaveLength(1);
    expect(subs[0]!.label).toBe("English");
    expect(subs[0]!.language).toBe("eng");
    expect(subs[0]!.vtt).toContain("WEBVTT");
    expect(subs[0]!.vtt).toContain("00:00:10.500 --> 00:00:12.500\nHello <i>world</i>");
    expect(subs[0]!.vtt).toContain("00:00:14.000 --> 00:00:15.500\nSecond line");
  });

  it("strips ASS markup down to the dialogue text", () => {
    const payload = "1,0,Default,,0,0,0,,{\\an8}Line one\\NLine two";
    const cluster = el(0x1f43b675, [
      ...el(0xe7, uintPayload(0)),
      ...el(0xa0, [...el(0xa1, simpleBlock(2, 100, payload)), ...el(0x9b, uintPayload(1000))]),
    ]);
    const subs = extractMkvSubtitles(mkv({ tracks: subtitleTrackEntry(2, "S_TEXT/ASS"), clusters: cluster }));
    expect(subs).toHaveLength(1);
    expect(subs[0]!.vtt).toContain("Line one\nLine two");
    expect(subs[0]!.vtt).not.toContain("{\\an8}");
  });

  it("ignores non-subtitle tracks and bitmap subs, keeps multiple text tracks", () => {
    const videoTrack = el(0xae, [...el(0xd7, [1]), ...el(0x83, [0x01]), ...el(0x86, Array.from(te.encode("V_VP8")))]);
    const pgsTrack = el(0xae, [...el(0xd7, [2]), ...el(0x83, [0x11]), ...el(0x86, Array.from(te.encode("S_HDMV/PGS")))]);
    const cluster = el(0x1f43b675, [
      ...el(0xe7, uintPayload(0)),
      ...el(0xa3, simpleBlock(1, 0, "videobytes")),
      ...el(0xa0, [...el(0xa1, simpleBlock(3, 0, "Bonjour")), ...el(0x9b, uintPayload(800))]),
      ...el(0xa0, [...el(0xa1, simpleBlock(4, 0, "Hello")), ...el(0x9b, uintPayload(800))]),
    ]);
    const subs = extractMkvSubtitles(
      mkv({
        tracks: [...videoTrack, ...pgsTrack, ...subtitleTrackEntry(3, "S_TEXT/UTF8", "", "fre"), ...subtitleTrackEntry(4, "S_TEXT/UTF8", "", "eng")],
        clusters: cluster,
      }),
    );
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.label).sort()).toEqual(["eng", "fre"]);
  });

  it("uses a 3s fallback duration for SimpleBlock cues and clamps '-->' in text", () => {
    const cluster = el(0x1f43b675, [...el(0xe7, uintPayload(1000)), ...el(0xa3, simpleBlock(1, 0, "a --> b"))]);
    const subs = extractMkvSubtitles(mkv({ tracks: subtitleTrackEntry(1, "S_TEXT/UTF8"), clusters: cluster }));
    expect(subs[0]!.vtt).toContain("00:00:01.000 --> 00:00:04.000\na → b");
  });

  it("returns nothing for non-EBML bytes and for files without text subs", () => {
    expect(extractMkvSubtitles(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
    const cluster = el(0x1f43b675, [...el(0xe7, uintPayload(0)), ...el(0xa3, simpleBlock(1, 0, "x"))]);
    const videoOnly = el(0xae, [...el(0xd7, [1]), ...el(0x83, [0x01]), ...el(0x86, Array.from(te.encode("V_VP8")))]);
    expect(extractMkvSubtitles(mkv({ tracks: videoOnly, clusters: cluster }))).toEqual([]);
  });

  it("survives an unknown-size cluster (streamed webm)", () => {
    // Cluster with size 0xFF (unknown) followed by its children, terminated by EOF.
    const kids = [...el(0xe7, uintPayload(0)), ...el(0xa0, [...el(0xa1, simpleBlock(1, 250, "streamed")), ...el(0x9b, uintPayload(500))])];
    const cluster = [...idBytes(0x1f43b675), 0xff, ...kids];
    const subs = extractMkvSubtitles(mkv({ tracks: subtitleTrackEntry(1, "S_TEXT/UTF8"), clusters: cluster }));
    expect(subs).toHaveLength(1);
    expect(subs[0]!.vtt).toContain("00:00:00.250 --> 00:00:00.750\nstreamed");
  });
});

describe("mkv audio track listing", () => {
  it("lists audio tracks with names and languages", () => {
    const audioJa = el(0xae, [
      ...el(0xd7, [2]),
      ...el(0x83, [0x02]),
      ...el(0x86, Array.from(te.encode("A_AAC"))),
      ...el(0x536e, Array.from(te.encode("Japanese"))),
      ...el(0x22b59c, Array.from(te.encode("jpn"))),
    ]);
    const audioEn = el(0xae, [...el(0xd7, [3]), ...el(0x83, [0x02]), ...el(0x86, Array.from(te.encode("A_AAC")))]);
    const info = extractMkvInfo(mkv({ tracks: [...audioJa, ...audioEn], clusters: [] }));
    expect(info.audio).toEqual([
      { number: 2, label: "Japanese", language: "jpn" },
      { number: 3, label: "", language: "und" },
    ]);
  });
});

describe("external subtitle files", () => {
  it("converts SRT to WebVTT (comma decimals, index lines)", () => {
    const srt = "1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,250\r\n<i>Line 1</i>\r\nLine 2\r\n";
    const vtt = srtToVtt(srt);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:00:01.500 --> 00:00:03.000\nHello");
    expect(vtt).toContain("00:01:00.000 --> 00:01:02.250\n<i>Line 1</i>\nLine 2");
    expect(vtt).not.toMatch(/\n1\n/);
  });

  it("converts ASS dialogue lines, honoring the Format field order", () => {
    const ass = [
      "[Script Info]",
      "Title: x",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\\i1}Salut{\\i0}\\Ndeuxième ligne",
    ].join("\n");
    const vtt = assFileToVtt(ass);
    expect(vtt).toContain("00:00:02.000 --> 00:00:04.500\nSalut\ndeuxième ligne");
    expect(vtt).not.toContain("{\\i1}");
  });

  it("decodes CJK subtitle files that are not UTF-8 (Shift_JIS)", () => {
    // "こんにちは" in Shift_JIS.
    const sjis = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
    expect(decodeSubtitleBytes(sjis)).toBe("こんにちは");
    expect(decodeSubtitleBytes(te.encode("UTF-8 text 日本語"))).toBe("UTF-8 text 日本語");
  });
});

describe("embedded ASS document reconstruction", () => {
  it("rebuilds a full .ass with the CodecPrivate header and timed Dialogue lines", () => {
    const header = "[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Arial\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";
    const entry = el(0xae, [
      ...el(0xd7, [1]),
      ...el(0x83, [0x11]),
      ...el(0x86, Array.from(te.encode("S_TEXT/ASS"))),
      ...el(0x63a2, Array.from(te.encode(header))),
    ]);
    const cluster = el(0x1f43b675, [
      ...el(0xe7, uintPayload(60000)), // 1 minute
      ...el(0xa0, [...el(0xa1, simpleBlock(1, 500, "7,0,Default,,0,0,0,,{\\b1}Bold{\\b0} text")), ...el(0x9b, uintPayload(2340))]),
    ]);
    const subs = extractMkvSubtitles(mkv({ tracks: entry, clusters: cluster }));
    expect(subs).toHaveLength(1);
    const doc = subs[0]!.assDoc!;
    expect(doc).toContain("[Script Info]");
    expect(doc).toContain("[Events]");
    expect(doc).toContain("Dialogue: 0,0:01:00.50,0:01:02.84,Default,,0,0,0,,{\\b1}Bold{\\b0} text");
    // The plain-text VTT fallback still strips the tags.
    expect(subs[0]!.vtt).toContain("Bold text");
    // SRT tracks get no assDoc.
    const srtSubs = extractMkvSubtitles(
      mkv({ tracks: subtitleTrackEntry(1, "S_TEXT/UTF8"), clusters: el(0x1f43b675, [...el(0xe7, uintPayload(0)), ...el(0xa3, simpleBlock(1, 0, "x"))]) }),
    );
    expect(srtSubs[0]!.assDoc).toBeUndefined();
  });
});
