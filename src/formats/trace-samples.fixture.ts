// Tiny trace and profile files for the routing tests (the readers' own tests live in traceview).

const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const field = (f: number, body: number[]): number[] => [...varint(f * 8 + 2), ...varint(body.length), ...body];
const num = (f: number, n: number): number[] => [...varint(f * 8), ...varint(n)];
const str = (f: number, s: string): number[] => field(f, [...new TextEncoder().encode(s)]);

const SYNC = [0x82, 0x47, 0x7a, 0x76, 0xb2, 0x8d, 0x42, 0xba, 0x81, 0xdc, 0x33, 0x32, 0x6d, 0x57, 0xa0, 0x79];

/** A Perfetto trace: one packet holding the synchronization marker, then a clock-stamped one. */
export const perfettoBytes = (): Uint8Array =>
  Uint8Array.from([...field(1, [...num(10, 1), ...field(36, SYNC)]), ...field(1, [...num(8, 5), ...num(10, 1)])]);

/** A pprof profile: one sample type, one sample, one function. */
export const pprofBytes = (): Uint8Array =>
  Uint8Array.from([
    ...field(1, [...num(1, 1), ...num(2, 2)]),
    ...field(2, [...field(1, [1]), ...field(2, [5])]),
    ...field(4, [...num(1, 1), ...field(4, [...num(1, 1)])]),
    ...field(5, [...num(1, 1), ...num(2, 3)]),
    ...str(6, ""),
    ...str(6, "cpu"),
    ...str(6, "nanoseconds"),
    ...str(6, "main"),
  ]);

/** simpleperf report-sample --protobuf: magic, version, then an empty record list. */
export const simpleperfBytes = (): Uint8Array =>
  Uint8Array.from([...new TextEncoder().encode("SIMPLEPERF"), 1, 0, 0, 0, 0, 0]);
