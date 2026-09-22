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

## Done first: the unused onnxruntime binary (2026-09-22)

The build shipped `ort-wasm-simd-threaded.asyncify.wasm` (23.5 MB, 5.7 MB compressed in the app
bundle) although transformers.js always loads onnxruntime from cdn.jsdelivr.net: confirmed in the
code and in a full translation run. The build now drops it (vite.config.ts), with a test that fails
if transformers.js stops loading from jsDelivr. The web build went from 72 MB to 49 MB (23.3 MB to
17.8 MB compressed pre-download), and F-Droid has no onnxruntime to build from source.

## The binaries, one by one

| Binary | Size | From | Build from source | Effort |
|---|---|---|---|---|
| ALAC decoder | 21 KB | mediaplay/alac (our repo) | `alac/build.sh` with emcc 4.0.7, sources in the package | Done: byte-identical |
| sql.js | 640 KB | npm sql.js | its Makefile, emcc 5.0.0 | Done: byte-identical |
| libav.js (AC-3/E-AC-3/DTS/TrueHD) | 820 KB | mediaplay/libav | libav.js v6.9.8.1, emcc 5.0.0 (mediaplay's copy rebuilt with that pin; same decoded audio) | Done: byte-identical |
| 7-Zip (write .7z) | 1.6 MB | npm 7z-wasm | 7-Zip 24.09 (GitHub release, checksum pinned) + 7z-wasm's patch, emcc 4.0.10, built WITHOUT RAR (unRAR licence is non-free for F-Droid; the app only writes .7z) | Done: identical with RAR, and the RAR-free build passes the archive tests |
| libarchive (read 7z/rar/xz/bz2) | 600 KB | npm libarchive-wasm | libarchive 3.7.7 + static OpenSSL 3.4.1, zlib, bzip2, xz (all checksums pinned), emcc 4.0.5 | Done: not byte-identical (cross-compiled, other prefix), reads all 13 upstream sample archives identically, app tests pass |
| libass (styled ASS subtitles) | 2.3 MB | npm @jellyfin/libass-wasm | JavascriptSubtitlesOctopus v4.2.4 with its pinned submodules (freetype, harfbuzz, fribidi, fontconfig, expat, brotli, libass), emcc 2.0.34 | Done: not byte-identical, renders a styled ASS test frame pixel-identical to npm's |

Also to check: the pdf.js wasm decoders (jbig2, openjpeg) are not in dist today, although scanned
PDFs need them (see the pdf.js memory note); find out how pdfedit loads them before the recipe.

## Shape of the F-Droid build

- One script in this repo, `scripts/fdroid/build-wasm.sh` (all six binaries; run it locally
  in a clean Debian with `scripts/fdroid/in-docker.sh`), that compiles every binary above from
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

1. Build script: done 2026-09-22, all six binaries, each checked against npm (byte-identical, or
   by behaviour where the build environment differs).
2. Dry run: done 2026-09-22. `fdroid build --on-server` in F-Droid's own image
   (registry.gitlab.com/fdroid/docker-executable-fdroidserver, Debian 13) builds
   app.omnitext_10600.apk (21.8 MB) from the recipe, scanner included. What it took: untracking a
   committed public/alac copy (the scanner's only finding), Node 24 like CI (npm 10 misreads the
   lockfile; since then Debian's own Node 20 + npm 9, at the reviewer's request), libtool-bin, a libtoolize wrapper for fontconfig on Debian 13, serial worker build.
   To repeat it: see "Dry run" below.
3. Store texts and images: done (fastlane/metadata/android/en-US/, from the Play listing with
   the updated privacy wording). First F-Droid version: 1.7 (10700), tagged fdroid-1.7 on the
   same commit as the Play 1.7 build.
4. The user submits the fdroiddata merge request (scripts/fdroid/app.omnitext.yml as
   metadata/app.omnitext.yml).

## Dry run

In a scratch folder: `metadata/app.omnitext.yml` (the recipe with `commit:` set to a pushed commit
until the tag exists), `config.yml` with `sdk_path: $ANDROID_HOME` (mode 600), fdroiddata's
`config/` folder (for lint), and a clone of the repository at `build/app.omnitext` (this
fdroidserver does not clone it itself). Then:

    docker run --rm -v "$PWD:/repo" -w /repo \
      registry.gitlab.com/fdroid/docker-executable-fdroidserver:master \
      build --verbose --on-server --no-tarball app.omnitext:10600

`--on-server` is what runs the recipe's sudo block (packages, Node), as F-Droid's CI does.
