# F-Droid build plan

Draft, 2026-09-22. Goal: an Omnitext build F-Droid accepts, built from source, run by hand once
in a while (not per commit). The Play build stays as it is.

## What F-Droid requires (f-droid.org/en/docs/Inclusion_Policy)

- 100% free toolchain, and the app built from source by F-Droid itself.
- Prebuilt binaries only from Maven Central, Google Maven and a few other listed repositories.
  WebAssembly shipped inside npm packages is not on that list: it has to be compiled from source
  during the build, or left out.
- No executable code downloaded at run time "without explicit user consent". Done: the consent
  prompt shipped 2026-09-22 (localml/consent + Settings > Downloads for AI features) asks before
  Tesseract and the onnxruntime files are fetched.
- No proprietary tracking or ads (none), anti-features labelled. Expect NonFreeNet for the model
  downloads from huggingface.co.

## First: the 23.5 MB onnxruntime binary (affects the Play build too)

The build ships `ort-wasm-simd-threaded.asyncify.wasm`, 23.5 MB: two thirds of the 33 MB APK, and
part of the ~70 MB (23 MB gzipped) the service worker pre-downloads for every web visitor on first
load. Yet a real translation run fetched its onnxruntime files from cdn.jsdelivr.net. So the
bundled copy may never be used.

To do: confirm which onnxruntime file each path loads (WebGPU, CPU) in a real run. Then either
- drop it from the bundle and the precache (lean; the files come from jsDelivr, behind the
  consent prompt), or
- point transformers.js at it and stop the jsDelivr fetch (self-contained, but keeps 23.5 MB).

Given "lean first", the expected answer is to drop it. For F-Droid it removes the hardest binary
to build from source (onnxruntime takes hours and a large toolchain).

## The binaries, one by one

| Binary | Size | From | Build from source | Effort |
|---|---|---|---|---|
| ALAC decoder | 21 KB | mediaplay/alac (our repo) | `alac/build.sh` with emcc, sources in the repo | Low |
| sql.js | 640 KB | npm sql.js | its Makefile + emsdk | Low |
| libav.js (AC-3/E-AC-3/DTS/TrueHD) | 820 KB | mediaplay/libav (committed binary) | libav.js repo, config documented in mediaplay/libav/NOTICE.md | Medium |
| 7-Zip (write .7z) | 1.6 MB | npm 7z-wasm | 7z-wasm repo, emscripten | Medium |
| libarchive (read 7z/rar/xz/bz2) | 600 KB | npm libarchive-wasm | its build, plus zlib/bzip2/xz/lz4 | Medium |
| libass (styled ASS subtitles) | 2.3 MB | npm @jellyfin/libass-wasm | JavascriptSubtitlesOctopus build (freetype, harfbuzz, fribidi, libass) | Medium to high |
| onnxruntime | 23.5 MB | via @huggingface/transformers | see above: likely dropped, not built | (none if dropped) |

Also to check: the pdf.js wasm decoders (jbig2, openjpeg) are not in dist today, although scanned
PDFs need them (see the pdf.js memory note); find out how pdfedit loads them before the recipe.

## Shape of the F-Droid build

- One script in this repo, `scripts/fdroid/build-wasm.sh`, that compiles every binary above from
  pinned upstream sources with a pinned emsdk and writes them where the npm copies would be.
  The Play build never runs it.
- A recipe in fdroiddata (a merge request to F-Droid, which the user submits): checkout a tag,
  install emsdk, run the script, `npm ci`, `npm run build`, `npx cap sync android`, gradle
  assembleRelease, with F-Droid's scanner told to delete the npm binaries that the script replaces.
- Cadence: F-Droid builds new tags it recognizes. Tagging `fdroid-<version>` by hand, and setting
  the recipe to follow that pattern, gives the "run manually once in a while" cadence.
- Fallback per binary: if one resists a clean source build, the F-Droid build can leave that
  feature out (the app already copes: files it cannot decode open in the hex view or with a
  notice), and say so in the description.

## Order

1. onnxruntime: measure, then drop (or keep) it. Ship the size win to Play and the web first.
2. Build script, easiest first: ALAC, sql.js, libav.js, 7-Zip, libarchive, libass. Each step
   checked by building the APK with the script's output and opening a sample file of that type.
3. Local dry run of the recipe with fdroidserver (`fdroid build` in its Docker image).
4. The user submits the fdroiddata merge request.
