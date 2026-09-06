// A .xz or .bz2 can hold a single compressed file rather than an archive of several, and
// libarchive cannot read that one. Its wasm build enables archive_read_support_format_all(),
// and libarchive deliberately keeps the "raw" format out of that set (it would swallow any
// input at all), so the stream is decompressed and then fails to parse as an archive.
//
// These two decoders cover exactly that case. Both are loaded only when it happens, so a
// zip, a tar or a 7z never pays for them.

const XZ = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const BZIP2 = [0x42, 0x5a, 0x68]; // "BZh"

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/** Whether these bytes are a compressed stream we can unwrap on their own. */
export const isSingleFileCompression = (bytes: Uint8Array): boolean =>
  startsWith(bytes, XZ) || startsWith(bytes, BZIP2);

/**
 * The contents of a lone .xz or .bz2, or null if these bytes are neither.
 *
 * Throws if the stream is one of those and is corrupt: a caller reaching here has already
 * failed to read the file as an archive, so silence would leave it with nothing to say.
 */
export async function decompressSingleFile(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (startsWith(bytes, XZ)) {
    // The package is UMD, so the constructor arrives as a named export or on the default
    // depending on how the bundler interops it.
    const mod = (await import("xzwasm")) as unknown as {
      XzReadableStream?: XzStreamCtor;
      default?: { XzReadableStream?: XzStreamCtor };
    };
    const XzReadableStream = mod.XzReadableStream ?? mod.default?.XzReadableStream;
    if (!XzReadableStream) throw new Error("xzwasm: no XzReadableStream export");
    const stream = new XzReadableStream(new Response(bytes as BufferSource).body!);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (startsWith(bytes, BZIP2)) {
    // bz2 exports itself differently depending on where it runs:
    //
    //   if (typeof window !== "undefined") window.bz2 = exports;
    //   else module.exports = exports;
    //
    // so in a browser it sets a global and exports nothing at all, and in node it is a
    // normal CommonJS module. Importing it is what runs that, and all three shapes are
    // checked afterwards. Reading a global is not something to do lightly, but here it is
    // the package's own browser contract, and the alternative is that a lone .bz2 works in
    // the tests and not in the app.
    const mod = (await import("bz2")) as unknown as {
      decompress?: Decompress;
      default?: { decompress?: Decompress };
    };
    const fromGlobal = (globalThis as { bz2?: { decompress?: Decompress } }).bz2;
    const decompress = mod.decompress ?? mod.default?.decompress ?? fromGlobal?.decompress;
    if (!decompress) throw new Error("bz2: no decompress export");
    return decompress(bytes);
  }
  return null;
}

type XzStreamCtor = new (source: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
type Decompress = (input: Uint8Array) => Uint8Array;
