# 7-Zip (LGPL-2.1-or-later, with the unRAR restriction)

Omnitext writes `.7z` archives with [7-Zip](https://www.7-zip.org/) itself, compiled to
WebAssembly by [7z-wasm](https://github.com/use-strict/7z-wasm). It is used when a file
opened from inside a `.7z` is saved back into it, and the archive has to be rebuilt.

7-Zip is Copyright (C) 1999-2015 Igor Pavlov, licensed under the GNU LGPL, with an added
restriction on its RAR code: it may not be used to develop a RAR-compatible archiver.
Omnitext does not do that. It writes only 7z, and reads RAR through libarchive.

## Meeting the LGPL here

- The library is a separate WebAssembly module, loaded on demand and never inlined into the
  application bundle, so it can be replaced with another build of the same interface.
- Its licence text ships with it, in `License.txt` inside the `7z-wasm` package.
- The source is upstream at the two links above; nothing in it has been modified.

The rest of Omnitext stays MIT. Using an LGPL library does not change that, and this is the
same arrangement already used for the libav.js audio decoders in `public/libav/`.
