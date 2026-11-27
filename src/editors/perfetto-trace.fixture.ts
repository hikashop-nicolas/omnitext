import { zlibSync } from "fflate";

// A tiny protobuf encoder that builds synthetic Perfetto traces for the tests.

type Part = number[] | Uint8Array;

export function varint(n: number): number[] {
  const out: number[] = [];
  if (n < 0) n += 2 ** 64; // int32 negatives are sign-extended to 10 bytes
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

const cat = (parts: Part[]): number[] => parts.flatMap((p) => Array.from(p));
export const u = (field: number, n: number): number[] => [...varint(field << 3), ...varint(n)];
export const bytes = (field: number, b: Part): number[] => [...varint((field << 3) | 2), ...varint(b.length), ...Array.from(b)];
export const m = (field: number, ...parts: Part[]): number[] => bytes(field, cat(parts));
export const s = (field: number, v: string): number[] => bytes(field, new TextEncoder().encode(v));
export const packed = (field: number, values: number[]): number[] => bytes(field, values.flatMap(varint));

/** A Trace from TracePacket bodies. */
export const trace = (...packets: Part[][]): Uint8Array => Uint8Array.from(packets.flatMap((p) => m(1, ...p)));

export const SYNC = [0x82, 0x47, 0x7a, 0x76, 0xb2, 0x8d, 0x42, 0xba, 0x81, 0xdc, 0x33, 0x32, 0x6d, 0x57, 0xa0, 0x79];

/** A small trace touching every decoded packet type. Times are in ns since boot. */
export function sampleTrace(): Uint8Array {
  const base = 5_000_000_000;
  const sched = m(4, packed(1, [base + 1000, 500, 500]), packed(7, [base + 1200]), s(5, "swapper"));
  const inner = Uint8Array.from(
    m(1, u(8, base + 4_000_000_000), m(39, m(1, u(2, 300), u(3, 301), u(5, base + 4_000_000_000), s(6, "Zipped"), u(7, 4), s(8, "from a compressed packet")))),
  );
  return trace(
    [u(10, 1), bytes(36, SYNC)],
    [u(8, base), m(6, m(1, u(1, 6), u(2, base)), m(1, u(1, 1), u(2, 1_700_000_000_000_000_000)))],
    [m(45, m(1, s(1, "Linux"), s(3, "6.1.0"), s(4, "aarch64")), s(2, "acme/phone/phone:15/AB12/1:user/release-keys"), u(5, 35), u(8, 8))],
    [
      u(8, base + 10),
      m(2,
        m(1, u(1, 1), u(2, 0), s(3, "/system/bin/init"), u(5, 0)),
        m(1, u(1, 300), u(2, 1), s(3, "com.example.app"), s(3, "--flag")),
        m(2, u(1, 301), u(3, 300), s(2, "RenderThread")),
      ),
    ],
    [u(8, base + 20), m(9, m(1, u(1, 300), u(3, 120_000)))],
    [
      m(1,
        u(1, 2),
        m(2, u(1, base + 500), u(2, 300), m(4, s(1, "a"), u(2, 1), s(5, "b"), u(6, 2))),
        m(2, u(1, base + 600), u(2, 300), m(3, s(2, "B|300|Choreographer#doFrame\n"))),
        m(2, u(1, base + 700), u(2, 300), m(3, s(2, "E|300\n"))),
        m(2, u(1, base + 800), m(11, u(1, 1_800_000), u(2, 0))),
        m(2, u(1, base + 900), m(9999, u(1, 1))),
        sched,
      ),
    ],
    [
      u(8, base + 2_000_000_000),
      m(39,
        m(1, u(2, 300), u(3, 301), u(5, base + 1_000_000_000), s(6, "ActivityManager"), u(7, 4), s(8, "Start proc 300")),
        m(1, u(2, 300), u(3, 300), u(5, base + 1_500_000_000), s(6, "AndroidRuntime"), u(7, 6), s(8, "FATAL EXCEPTION: main")),
      ),
    ],
    [u(10, 2), u(13, 1), m(60, u(1, 77), m(3, u(1, 400), s(6, "com.example.sdk")))],
    [u(10, 2), m(44, u(1, 400), u(2, 401), s(5, "worker"))],
    [u(10, 2), u(8, base + 3_000_000_000), m(12, m(2, u(1, 5), s(2, "DrawFrame"))), m(11, u(9, 1), u(10, 5), u(11, 77))],
    [u(10, 2), u(8, base + 3_000_000_100), m(11, u(9, 2), u(11, 77))],
    [u(10, 2), u(8, base + 3_000_000_200), m(11, u(9, 3), s(23, "Tap"))],
    [bytes(50, zlibSync(inner))],
  );
}
