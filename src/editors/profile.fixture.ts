// A tiny protobuf writer for tests: pprof and simpleperf profiles built field by field.

const enc = new TextEncoder();

export function varint(n: number): number[] {
  const out: number[] = [];
  // Negative numbers as protobuf writes int64: ten bytes of two's complement.
  let v = BigInt.asUintN(64, BigInt(n));
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

export const vfield = (f: number, n: number): number[] => [...varint(f * 8), ...varint(n)];
export const lfield = (f: number, body: number[] | Uint8Array): number[] => [...varint(f * 8 + 2), ...varint(body.length), ...body];
export const sfield = (f: number, s: string): number[] => lfield(f, enc.encode(s));
export const packed = (f: number, ns: number[]): number[] => lfield(f, ns.flatMap(varint));

export interface PprofSpec {
  types: [string, string][];
  /** Function names; function and location ids are index + 1. */
  functions: string[];
  /** Location ids, leaf first, with values and optional string labels. */
  samples: { locs: number[]; values: number[]; labels?: [string, string][] }[];
  /** A location with two lines: inlined callee first. */
  inlined?: [number, number];
  defaultType?: string;
}

/** A pprof Profile message (not gzipped). */
export function pprofBytes(spec: PprofSpec): Uint8Array {
  const strings = [""];
  const s = (v: string) => {
    let i = strings.indexOf(v);
    if (i < 0) i = strings.push(v) - 1;
    return i;
  };
  const out: number[] = [];
  for (const [type, unit] of spec.types) out.push(...lfield(1, [...vfield(1, s(type)), ...vfield(2, s(unit))]));
  for (const smp of spec.samples) {
    const labels = (smp.labels ?? []).flatMap(([k, v]) => lfield(3, [...vfield(1, s(k)), ...vfield(2, s(v))]));
    out.push(...lfield(2, [...packed(1, smp.locs), ...packed(2, smp.values), ...labels]));
  }
  out.push(...lfield(3, [...vfield(1, 1), ...vfield(5, s("/bin/app"))]));
  spec.functions.forEach((_, i) => {
    const lines = spec.inlined && spec.inlined[0] === i + 1 ? [spec.inlined[1], i + 1] : [i + 1];
    out.push(...lfield(4, [...vfield(1, i + 1), ...vfield(2, 1), ...vfield(3, 0x1000 + i), ...lines.flatMap((fn) => lfield(4, [...vfield(1, fn), ...vfield(2, 10 + fn)]))]));
  });
  spec.functions.forEach((name, i) => out.push(...lfield(5, [...vfield(1, i + 1), ...vfield(2, s(name)), ...vfield(4, s("main.go"))])));
  if (spec.defaultType) s(spec.defaultType);
  // Strings go last, as Go writes them; a time comes first.
  const head = vfield(9, 1_700_000_000);
  const def = spec.defaultType ? vfield(14, s(spec.defaultType)) : [];
  const tail = strings.flatMap((v) => sfield(6, v));
  return Uint8Array.from([...head, ...out, ...tail, ...def]);
}

/** simpleperf report-sample --protobuf: magic, version, size-prefixed records, a zero end. */
export function simpleperfBytes(records: number[][]): Uint8Array {
  const out: number[] = [...enc.encode("SIMPLEPERF"), 1, 0];
  for (const r of records) {
    const n = r.length;
    out.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24, ...r);
  }
  out.push(0, 0, 0, 0);
  return Uint8Array.from(out);
}

export const spSample = (time: number, tid: number, count: number, chain: [number, number][], event = 0): number[] =>
  lfield(1, [...vfield(1, time), ...vfield(2, tid), ...chain.flatMap(([file, sym]) => lfield(3, [...vfield(1, 0x100), ...vfield(2, file), ...vfield(3, sym)])), ...vfield(4, count), ...vfield(5, event)]);
export const spFile = (id: number, path: string, symbols: string[]): number[] =>
  lfield(3, [...vfield(1, id), ...sfield(2, path), ...symbols.flatMap((x) => sfield(3, x))]);
export const spThread = (tid: number, pid: number, name: string): number[] => lfield(4, [...vfield(1, tid), ...vfield(2, pid), ...sfield(3, name)]);
export const spMeta = (events: string[]): number[] => lfield(5, events.flatMap((e) => sfield(1, e)));
