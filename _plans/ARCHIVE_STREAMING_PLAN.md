# Archive streaming plan (2026-07-17)

## Problem

Opening an archive reads the WHOLE file into memory (`file.arrayBuffer()` in every open
path), then the archive viewer calls `readArchiveAsync`, which decompresses EVERY entry
into its own `Uint8Array` just to render the name + size list (`core/archive.ts`,
`editors/archive.impl.ts`). A large archive therefore freezes/OOMs the tab on open, and
holds N decompressed copies it never needed.

## Approach (agreed with owner)

Reuse the Blob approach: keep the archive as the on-disk `Blob`/`File` and read only the
bytes we need, on demand, via `Blob.slice()`. List entries from headers/central-directory
without decompressing; decompress a single entry only when the user Opens/Extracts it.
Do all four format families this pass (owner: "all formats now"), within each format's
physical limits (gzip can't seek; libarchive is a forward-only reader that needs the whole
archive in WASM memory).

## Core abstraction

`src/core/archive-stream.ts`:

```
export interface StreamEntry { name: string; size: number; dir: boolean; }
export interface ArchiveHandle {
  entries: StreamEntry[];              // listed WITHOUT decompressing bodies
  read(name: string): Promise<Uint8Array>;  // decompress/extract one entry on demand
}
// Returns null when the format can't be streamed here (caller uses the full-load path).
export async function openArchiveStream(blob: Blob, filename?: string): Promise<ArchiveHandle | null>;
```

## Per-format implementation

- **zip / jar / cbz** (best win): read the End-Of-Central-Directory from the tail via
  `blob.slice(size - tail)`, parse the central directory (one `blob.slice` range) into
  entries {name, method, compressedSize, size, localOffset}, incl. ZIP64 (EOCD64 locator +
  64-bit sentinels in the extra field). `read()` slices the local header + compressed range
  and inflates just that entry (fflate `inflateSync` for method 8, raw for method 0).
  Memory = central directory + one entry.
- **tar**: walk 512-byte headers by slicing 512 bytes at each offset (skip bodies by
  advancing offset); `read()` slices the one entry's data range. Memory = one header/entry.
  Reuse the ustar name/prefix parsing from `tar.ts`.
- **tgz / tar.gz**: gzip is one stream, no seek. Stream-gunzip from `blob.stream()` with a
  tar-header state machine to build the entry table (discarding bodies -> bounded memory);
  `read()` re-streams and captures only the target entry. Trades CPU (re-decompress) for
  bounded memory.
- **libarchive (7z / rar / xz / bzip2)**: forward-only reader needing the whole archive in
  WASM memory (lib constraint). List via `reader.entries()` reading name + size, skipping
  `readData()`; `read()` re-iterates to the target and reads its data. Avoids copying every
  entry to the JS heap.

## Pipeline change (pass the Blob, don't materialize)

- `EditorMountContext` + `MountOpts` gain `blob?: Blob`.
- A File/Blob-aware open fast-path: when the opened File's extension/MIME is an archive,
  route to the archive viewer with the `Blob` and SKIP `file.arrayBuffer()`. Non-archive
  and unknown-type files keep the current bytes path (sniffing needs bytes).
- The archive viewer takes `ctx.blob` (falls back to wrapping `ctx.bytes` in a Blob for the
  recovery/in-memory paths), calls `openArchiveStream`, renders `entries`, and wires
  Open/Extract to `read(name)`.

## Out of scope / unchanged

- Save-back / re-pack (`saveIntoArchive`) still reads the whole archive: editing an entry
  and writing the archive back inherently needs every entry. Rare, explicit, write-path.
- Editing archives in place is not added here; this is read/list/extract streaming.

## Phases

1. `archive-stream.ts` zip reader + unit tests (fixtures via fflate `zipSync`). [core, testable]
2. tar + tgz readers + tests.
3. libarchive list-then-extract-on-demand.
4. Pipeline: `blob` through the open fast-path + `EditorMountContext`; archive viewer
   consumes `ArchiveHandle`.
5. Browser verification (large zip/tar/7z: list is instant, one entry opens on demand).

## Verification

- Unit: golden round-trip per format (build an archive, stream-list it, read each entry,
  assert bytes match a full-decompress reference).
- Browser: open a multi-hundred-MB zip; the list renders without a full decompress; Open on
  one entry pulls just that entry.
